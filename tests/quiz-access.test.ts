import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { transformSync } from "esbuild";

type Session = { user: { id: string; role: string; banned?: boolean } } | null;
type Handler = (request: Request, context: { params: Promise<{ quiz_id: string }> }) => Promise<Response>;
type Row = Record<string, unknown>;
const learner: Session = { user: { id: "learner", role: "user" } };
const admin: Session = { user: { id: "administrator", role: "admin" } };

function loadRoute(path: string, session: Session, rows: Row[][] = []) {
  let reads = 0;
  let writes = 0;
  let generations = 0;
  const inserts: unknown[] = [];
  const filters: unknown[] = [];
  const schema = Object.fromEntries([
    ["QuizSchema", ["id", "created_by"]],
    ["metadata", ["quiz_id", "is_public"]],
    ["quiz_question", ["id", "quiz_id"]],
    ["quiz_answer_question", ["quiz_id", "user_id", "attempt", "answered_at"]],
  ].map(([name, columns]) => [name, Object.fromEntries((columns as string[]).map((column) => [column, `${name}.${column}`]))]));
  const database = {
    select: () => {
      reads++;
      const result = rows.shift() ?? [];
      const chain = {
        from: () => chain, leftJoin: () => chain,
        where: (filter: unknown) => { filters.push(filter); return chain; },
        orderBy: () => chain, groupBy: () => chain, limit: () => chain,
        then: (resolve: (value: Row[]) => unknown) => Promise.resolve(result).then(resolve),
      };
      return chain;
    },
    $count: () => 0,
    insert: () => { writes++; return { values: async (value: unknown) => { inserts.push(value); } }; },
    delete: () => { writes++; return { where: async () => [] }; },
    update: () => { writes++; return { set: () => ({ where: async () => [] }) }; },
  };
  const next = { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } };
  const helperSandbox = { exports: {} as Record<string, unknown> };
  runInNewContext(transformSync(readFileSync("lib/auth/api-access.ts", "utf8"), { loader: "ts", format: "cjs" }).code, {
    module: helperSandbox, Request, Response, URL, process: { env: {} },
    require: (specifier: string) => {
      if (specifier === "@/app/lib/auth") return { auth: { api: { getSession: async () => session } } };
      if (specifier === "next/server") return next;
      throw new Error(`Unexpected helper import ${specifier}`);
    },
  });
  const sandbox = { exports: {} as Record<string, Handler> };
  runInNewContext(transformSync(readFileSync(path, "utf8"), { loader: "ts", format: "cjs" }).code, {
    module: sandbox, Request, Response, URL, crypto, console: { log() {}, error() {} },
    require: (specifier: string) => {
      if (specifier === "@/lib/auth/api-access") return helperSandbox.exports;
      if (specifier === "next/server") return next;
      if (specifier === "@/db/drizzle") return database;
      if (specifier.includes("schema/quiz-schema")) return schema;
      if (specifier.includes("lib/genai")) return { generateQuiz: async () => { generations++; throw new Error("Provider must not run"); } };
      if (specifier === "drizzle-orm") return { eq: (...args: unknown[]) => args, and: (...args: unknown[]) => args, asc: (value: unknown) => value, desc: (value: unknown) => value };
      throw new Error(`Unexpected route import ${specifier}`);
    },
  });
  return { handlers: sandbox.exports, reads: () => reads, writes: () => writes,
    generations: () => generations, inserts, filters };
}

function request(method: string, body?: unknown, query = "") {
  return new Request(`https://app.invalid/api/quiz${query}`, {
    method, headers: { "content-type": "application/json", origin: "https://app.invalid" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const context = () => ({ params: Promise.resolve({ quiz_id: "quiz-one" }) });
const paths = {
  root: "app/api/quiz/route.ts", save: "app/api/quiz/save/route.ts",
  all: "app/api/quiz/all/route.ts", my: "app/api/quiz/my/route.ts",
  get: "app/api/quiz/get/[quiz_id]/route.ts", history: "app/api/quiz/answers/[quiz_id]/route.ts",
  answers: "app/api/quiz/answers/save/route.ts",
};

test("private quiz handlers reject anonymous users before database/provider access", async () => {
  for (const [path, method] of [
    [paths.root, "POST"], [paths.root, "DELETE"], [paths.save, "POST"],
    [paths.my, "POST"],
    [paths.history, "GET"], [paths.answers, "POST"],
  ]) {
    const loaded = loadRoute(path, null);
    const response = await loaded.handlers[method](request(method, method === "GET" ? undefined : {}), context());
    assert.equal(response.status, 401, `${method} ${path}`);
    assert.equal(loaded.reads() + loaded.writes() + loaded.generations(), 0);
  }
});

test('guests can play public quizzes but cannot read private questions or bypass listing filters', async () => {
  const listing = loadRoute(paths.all, null);
  assert.equal((await listing.handlers.GET(request('GET'), context())).status, 200);
  assert.ok(listing.filters.some((value) => JSON.stringify(value) === JSON.stringify(['metadata.is_public', true])));
  for (const created_by of ['owner', null, undefined]) {
    const hidden = loadRoute(paths.get, null, [[{ id: 'quiz-one', created_by }], [{ is_public: false }]]);
    assert.equal((await hidden.handlers.GET(request('GET'), context())).status, 404);
    assert.equal(hidden.reads(), 2);
  }
  const visible = loadRoute(paths.get, null, [[{ id: 'quiz-one', created_by: 'owner' }], [{ is_public: true }], [{ id: 'question' }]]);
  assert.equal((await visible.handlers.GET(request('GET'), context())).status, 200);
  assert.equal(visible.writes(), 0);
});

test("quiz generation/save/delete require admin before parsing or executing work", async () => {
  for (const [path, method] of [[paths.root, "POST"], [paths.root, "DELETE"], [paths.save, "POST"]]) {
    const loaded = loadRoute(path, learner);
    assert.equal((await loaded.handlers[method](request(method, {}), context())).status, 403);
    assert.equal(loaded.reads() + loaded.writes() + loaded.generations(), 0);
  }
  const allowed = loadRoute(paths.root, admin);
  assert.equal((await allowed.handlers.DELETE(request("DELETE", { quizId: "quiz-one" }), context())).status, 200);
  assert.equal(allowed.writes(), 3);
});

test("quiz history and creator lists deny cross-user requests before database reads", async () => {
  const history = loadRoute(paths.history, learner);
  assert.equal((await history.handlers.GET(request("GET", undefined, "?user_id=another-user"), context())).status, 403);
  assert.equal(history.reads(), 0);
  const mine = loadRoute(paths.my, learner);
  assert.equal((await mine.handlers.POST(request("POST", { userId: "another-user" }), context())).status, 403);
  assert.equal(mine.reads(), 0);
  const owner = loadRoute(paths.history, learner, [[]]);
  assert.equal((await owner.handlers.GET(request("GET", undefined, "?user_id=learner"), context())).status, 200);
  assert.equal(owner.reads(), 1);
});

test("private quizzes do not expose questions to other learners", async () => {
  const denied = loadRoute(paths.get, learner, [[{ id: "quiz-one", created_by: "other" }], [{ is_public: false }]]);
  assert.equal((await denied.handlers.GET(request("GET"), context())).status, 404);
  assert.equal(denied.reads(), 2);
  const allowed = loadRoute(paths.get, learner, [[{ id: "quiz-one", created_by: "other" }], [{ is_public: true }], [{ id: "question" }]]);
  assert.equal((await allowed.handlers.GET(request("GET"), context())).status, 200);
  assert.equal(allowed.reads(), 3);
});

test("quiz listing is dynamic and filters hidden metadata for non-admin sessions", async () => {
  const listing = loadRoute(paths.all, learner);
  assert.equal((await listing.handlers.GET(request("GET"), context())).status, 200);
  assert.ok(listing.filters.some((value) => JSON.stringify(value) === JSON.stringify(["metadata.is_public", true])));
  assert.match(readFileSync(paths.all, "utf8"), /dynamic = "force-dynamic"/);
});

const answer = { quiz_id: "quiz-one", quiz_question_id: "question-one", user_id: "learner", user_answer: "wrong", is_correct: true };
test("answer submissions reject forged identities, mixed quizzes and duplicate questions without writes", async () => {
  for (const [answers, userId, status] of [
    [[{ ...answer, user_id: "other" }], undefined, 403],
    [[answer], "other", 403],
    [[answer, { ...answer, quiz_id: "quiz-two", quiz_question_id: "question-two" }], undefined, 400],
    [[answer, answer], undefined, 400],
  ] as const) {
    const loaded = loadRoute(paths.answers, learner);
    const response = await loaded.handlers.POST(request("POST", { answers, user_id: userId }), context());
    assert.equal(response.status, status);
    assert.equal(loaded.reads() + loaded.writes(), 0);
  }
});

test("answer writes bind identity/attempt/time and recompute correctness from stored questions", async () => {
  const questions = [
    { id: "question-one", type: "MCQ", options: ["right", "wrong"], correct_answer: "0" },
    { id: "question-two", type: "IDT", correct_answer: "tala" },
    { id: "question-three", type: "SKT", character: "ka" },
  ];
  const loaded = loadRoute(paths.answers, learner, [
    [{ id: "quiz-one", created_by: "admin" }], [{ is_public: true }], questions, [{ attempt: 3 }],
  ]);
  const response = await loaded.handlers.POST(request("POST", { answers: [
    { ...answer, attempt: 999, answered_at: "untrusted" },
    { ...answer, quiz_question_id: "question-two", user_answer: " TA LA ", is_correct: false },
    { ...answer, quiz_question_id: "question-three", user_answer: "ka", is_correct: false },
  ] }), context());
  assert.equal(response.status, 200);
  const stored = JSON.parse(JSON.stringify(loaded.inserts[0])) as Row[];
  assert.deepEqual(stored.map((row) => row.is_correct), [false, true, true]);
  assert.ok(stored.every((row) => row.user_id === "learner" && row.attempt === 4 && row.answered_at !== "untrusted"));
});

test("foreign question references are rejected before answer insertion", async () => {
  const loaded = loadRoute(paths.answers, learner, [[{ id: "quiz-one" }], [{ is_public: true }], []]);
  assert.equal((await loaded.handlers.POST(request("POST", { answers: [answer] }), context())).status, 400);
  assert.equal(loaded.writes(), 0);
});

test("server grading preserves current and legacy gameplay aliases", async () => {
  for (const question of [
    { id: "question-one", type: "quiz", correct_answer: "TA LA", submitted: " tala " },
    { id: "question-one", type: "identification", correct_answer: "tala", submitted: "TA LA" },
    { id: "question-one", type: "multipleChoice", correct_answer: "1", options: ["wrong", "right"], submitted: "right" },
    { id: "question-one", type: "MCQ", correct_answer: null, options: ["first", "wrong"], submitted: "first" },
    { id: "question-one", type: "sketch", character: "ka", submitted: "ka" },
  ]) {
    const loaded = loadRoute(paths.answers, learner, [
      [{ id: "quiz-one" }], [{ is_public: true }], [question], [],
    ]);
    const response = await loaded.handlers.POST(request("POST", {
      answers: [{ ...answer, user_answer: question.submitted, is_correct: false }],
    }), context());
    assert.equal(response.status, 200, question.type);
    const stored = JSON.parse(JSON.stringify(loaded.inserts[0])) as Row[];
    assert.equal(stored[0].is_correct, true, question.type);
  }
});

test("admin quiz save cannot move another quiz's existing question", async () => {
  const loaded = loadRoute(paths.save, admin, [[{ id: "foreign-question", quiz_id: "quiz-two" }]]);
  const response = await loaded.handlers.POST(request("POST", {
    id: "quiz-one", metadata: {}, questions: [{ id: "foreign-question" }],
  }), context());
  assert.equal(response.status, 500);
  assert.equal(loaded.writes(), 0);
});

test("admin quiz creation binds the creator to the verified session", async () => {
  const loaded = loadRoute(paths.save, admin, [[]]);
  const response = await loaded.handlers.POST(request("POST", {
    id: "quiz-one", created_by: "forged-creator", metadata: {
      quiz_name: "Synthetic quiz", difficulty: "Easy", category: "local", time_limit: 30,
    }, questions: [],
  }), context());
  assert.equal(response.status, 200);
  assert.equal(loaded.writes(), 2);
  const master = JSON.parse(JSON.stringify(loaded.inserts[0])) as Row;
  assert.equal(master.created_by, "administrator");
});
