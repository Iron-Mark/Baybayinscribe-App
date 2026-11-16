import assert from "node:assert/strict";
import test from "node:test";
import axios from "../lib/axios";
import { useModuleStore } from "../app/store/store.modules";
import { useLearningResourceStore } from "../app/store/store.lr";

test("module fetch normalizes the API array and clears a stale module", async () => {
  const originalAdapter = axios.defaults.adapter;
  try {
    const moduleDetail = { id: "synthetic-module", file: [{ url: "https://example.invalid/module.md" }] };
    axios.defaults.adapter = async (config) => ({
      data: [moduleDetail], status: 200, statusText: "OK", headers: {}, config,
    });
    await useModuleStore.getState().getModule("synthetic-lesson", "synthetic-module");
    assert.deepEqual(useModuleStore.getState().module, moduleDetail);
    assert.equal(useModuleStore.getState().status, "Loaded");

    axios.defaults.adapter = async (config) => ({
      data: [], status: 200, statusText: "OK", headers: {}, config,
    });
    await useModuleStore.getState().getModule("synthetic-lesson", "missing-module");
    assert.equal(useModuleStore.getState().module, null);

    axios.defaults.adapter = async () => { throw new Error("Synthetic transport failure"); };
    await useModuleStore.getState().getModule("synthetic-lesson", "synthetic-module");
    assert.equal(useModuleStore.getState().module, null);
    assert.equal(useModuleStore.getState().status, "Error");
  } finally {
    axios.defaults.adapter = originalAdapter;
  }
});

test("lesson fetch preserves the nested API detail and clears it on failure", async () => {
  const originalAdapter = axios.defaults.adapter;
  try {
    const detail = {
      learning_resource: { id: "synthetic-lesson", title: "Synthetic lesson" },
      learning_resource_module: [],
    };
    axios.defaults.adapter = async (config) => ({
      data: detail, status: 200, statusText: "OK", headers: {}, config,
    });
    assert.deepEqual(await useLearningResourceStore.getState().getLesson("synthetic-lesson"), detail);
    assert.deepEqual(useLearningResourceStore.getState().lesson, detail);

    axios.defaults.adapter = async () => { throw new Error("Synthetic transport failure"); };
    assert.equal(await useLearningResourceStore.getState().getLesson("missing-lesson"), undefined);
    assert.equal(useLearningResourceStore.getState().lesson, undefined);
    assert.equal(useLearningResourceStore.getState().status, "Error");
  } finally {
    axios.defaults.adapter = originalAdapter;
  }
});
