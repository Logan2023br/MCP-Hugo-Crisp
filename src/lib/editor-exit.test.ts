import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EDITOR_EXIT_MESSAGE_VI,
  EDITOR_EXIT_MESSAGE_EN,
  pickEditorExitMessage,
  requireEditorExit,
} from "./editor-exit.ts";

/**************************************************************************
 * pickEditorExitMessage — fallback path (tests run without ANTHROPIC_API_KEY)
 ***************************************************************************/

test("pickEditorExitMessage: Vietnamese diacritics → VI fallback", async () => {
  assert.equal(
    await pickEditorExitMessage("Mình bị lỗi rồi"),
    EDITOR_EXIT_MESSAGE_VI
  );
});

test("pickEditorExitMessage: English → EN fallback", async () => {
  assert.equal(
    await pickEditorExitMessage("My page is broken"),
    EDITOR_EXIT_MESSAGE_EN
  );
});

test("pickEditorExitMessage: empty / undefined → EN fallback default", async () => {
  assert.equal(await pickEditorExitMessage(""), EDITOR_EXIT_MESSAGE_EN);
  assert.equal(await pickEditorExitMessage(undefined), EDITOR_EXIT_MESSAGE_EN);
});

/**************************************************************************
 * requireEditorExit
 ***************************************************************************/

test("requireEditorExit: userExitedEditor=true → ready", async () => {
  const result = await requireEditorExit(true, "Hi");
  assert.equal(result.ready, true);
});

test("requireEditorExit: userExitedEditor=false → not ready, missing editor_exit", async () => {
  const result = await requireEditorExit(false, "Hi");
  assert.equal(result.ready, false);
  if (result.ready === false) {
    assert.equal(result.output.is_ready_for_escalation, false);
    assert.deepEqual(result.output.missing_info, ["editor_exit"]);
    assert.equal(result.output.note_posted, false);
    assert.equal(result.output.crisp_note.content, "");
    assert.match(result.output.next_step_for_user, /(thoát editor|exit the PageFly editor)/);
  }
});

test("requireEditorExit: userExitedEditor=undefined → not ready", async () => {
  const result = await requireEditorExit(undefined, "Hi");
  assert.equal(result.ready, false);
});

test("requireEditorExit: VI customer → VI fallback message", async () => {
  const result = await requireEditorExit(false, "Trang của mình bị lỗi");
  assert.equal(result.ready, false);
  if (result.ready === false) {
    assert.equal(result.output.next_step_for_user, EDITOR_EXIT_MESSAGE_VI);
  }
});

test("requireEditorExit: EN customer → EN fallback message", async () => {
  const result = await requireEditorExit(false, "My page is broken");
  assert.equal(result.ready, false);
  if (result.ready === false) {
    assert.equal(result.output.next_step_for_user, EDITOR_EXIT_MESSAGE_EN);
  }
});

test("requireEditorExit: note_post_error explains the gate", async () => {
  const result = await requireEditorExit(false);
  assert.equal(result.ready, false);
  if (result.ready === false) {
    assert.match(result.output.note_post_error, /exit the PageFly editor/);
    assert.match(result.output.note_post_error, /user_exited_editor=true/);
  }
});
