// Reuses the existing browser-fixture approach; opens no listening socket.
// Real GuestNotice/LessonProvider/QuizTakeContent, mocked Next/auth/data boundaries.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const bundle = await build({
  stdin: { resolveDir: process.cwd(), sourcefile: 'guest-fixture.tsx', loader: 'tsx', contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import GuestNotice from './components/GuestNotice';
    import {LessonProvider,useLessonContext} from './app/(screens)/lesson/LessonContext';
    import {QuizTakeContent} from './app/(screens)/quiz/take/[quiz_id]/QuizTakeContent';
    function Probe(){const ctx=useLessonContext();return <section><span data-status>{ctx.status}</span><span data-lesson>{ctx.lesson?.learning_resource.id}</span><span data-finished>{String(ctx.lesson?.learning_resource_module[0]?.is_finished)}</span><button onClick={()=>ctx.completeGuestModule('module')}>Complete guest module</button></section>}
    function Fixture(){const[id,setId]=useState('one');return <><GuestNotice/><button onClick={()=>setId('two')}>Change lesson</button><LessonProvider lessonId={id}><Probe/></LessonProvider><QuizTakeContent/></>}
    createRoot(document.getElementById('root')).render(<Fixture/>);
  ` },
  bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'fixture-boundaries', setup(plugin) {
    plugin.onResolve({ filter: /^(next\/(image|link|navigation)|.*auth-client|.*store\.inference|.*\.webp|@\/lib\/axios|@\/app\/store\/store.quiz|\.\/QuizTakeContext)$/ }, (args) => ({ path: args.path, namespace: 'stub' }));
    plugin.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => {
      let contents;
      if (args.path.endsWith('.webp')) contents = `export default {src:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'};`;
      else if (args.path.endsWith('store.inference')) contents = `export const InferenceStatus={IDLE:'IDLE',READY:'READY',ERROR:'ERROR'};export const useInferenceStore=()=>({});`;
      else if (args.path === 'next/image') contents = `import React from 'react';export default function Image({src,unoptimized,priority,fill,...p}){return <img {...p} src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"/>}`;
      else if (args.path === 'next/link') contents = `import React from 'react';export default function Link(p){return <a {...p}/>}`;
      else if (args.path === 'next/navigation') contents = `export const useRouter=()=>({push(){},back(){},refresh(){}});`;
      else if (args.path.endsWith('auth-client')) contents = `const data=location.search.includes('signed-in')?{user:{id:'actor',role:'user'}}:null;export const authClient={getSession:async()=>({data}),useSession:()=>({data,isPending:false})};`;
      else if (args.path === '@/lib/axios') contents = `function lesson(url){return {learning_resource:{id:url.split('/').pop()},learning_resource_module:[{id:'module',is_finished:false,file:null}]}}export default {get:async(url)=>{window.reads.push(url);return{data:lesson(url)}},post:async(url,body)=>{window.reads.push({url,body});return{data:lesson(url)}}};`;
      else if (args.path === '@/app/store/store.quiz') contents = `export default function useQuizStore(selector){return selector({submitQuizAnswers:(quizId,answers)=>window.writes.push({quizId,answers})})}`;
      else contents = `const quiz={metadata:{quiz_id:'quiz',quiz_name:'Synthetic quiz',difficulty:'Easy'},questions:[{id:'question'}]};const context={quiz,progress:1,health:3,answerHistory:[{quiz_question_id:'question',is_correct:true,user_answer:'A',quiz_id:'quiz'}],recordAnswer(){},onSubmit(){},currentQuestion:undefined};export const useQuizTakeContext=()=>context;`;
      return { contents, loader: 'tsx', resolveDir: process.cwd() };
    });
  } }],
});
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});
const results = [];
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    for (const signedIn of [false, true]) {
      const context = await browser.newContext({ viewport });
      const errors = [];
      await context.route('**/*', (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/fixture') return route.fulfill({ contentType: 'text/html', body: '<html><body><div id="root"></div><script>window.reads=[];window.writes=[];</script><script src="/bundle.js"></script></body></html>' });
        if (path === '/bundle.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text });
        return route.abort();
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`http://guest-fixture.invalid/fixture${signedIn ? '?signed-in' : ''}`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent === 'Loaded');
      assert.equal(await page.locator('[data-lesson]').textContent(), 'one');
      if (!signedIn) {
        await page.getByRole('complementary', { name: 'Guest mode' }).waitFor();
        // The completed quiz result overlays the fixture. Dispatch directly to
        // test the real context transition without claiming layout interaction.
        await page.getByRole('button', { name: 'Complete guest module' }).dispatchEvent('click');
        await page.waitForFunction(() => document.querySelector('[data-finished]')?.textContent === 'true');
        assert.equal(await page.evaluate(() => window.writes.length), 0);
        assert.ok((await page.evaluate(() => window.reads)).every((read) => typeof read === 'string'));
      } else {
        assert.equal(await page.getByRole('complementary', { name: 'Guest mode' }).count(), 0);
        const writes = await page.evaluate(() => window.writes);
        assert.equal(writes.length, 1);
        assert.equal(writes[0].answers[0].user_id, 'actor');
      }
      await page.getByRole('button', { name: 'Change lesson' }).dispatchEvent('click');
      await page.waitForFunction(() => document.querySelector('[data-lesson]')?.textContent === 'two');
      assert.deepEqual(errors, []);
      results.push({ viewport, signedIn, pageErrors: 0, quizWrites: await page.evaluate(() => window.writes.length), lessonNavigation: 'one -> two' });
      await context.close();
    }
  }
  console.log(JSON.stringify({ result: 'PASS', results, scope: 'Real components, synthetic boundaries, no CSS/layout/live-server/model claim.' }, null, 2));
} finally { await browser.close(); }
