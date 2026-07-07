import { test, testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

// Skipping because snapshotting the security findings table is not
// consistent across platforms because different amounts of text
// get ellipsis'd out.
testSkipIfWindows("security review", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=1");

  await po.previewPanel.selectPreviewMode("security");

  await po.securityReview.clickRunSecurityReview();
  await po.snapshotServerDump("all-messages");
  await po.securityReview.snapshotSecurityFindingsTable();

  await po.page.getByRole("button", { name: "Fix Issue" }).first().click();
  await po.chatActions.waitForChatCompletion();
  await expect(async () => {
    const text = await po.page.getByTestId("messages-list").textContent();
    expect(text).toMatch(
      /Please fix the following security issue[\s\S]*Version 2:/,
    );
  }).toPass({ timeout: Timeout.MEDIUM });
  await po.snapshotMessages({
    name: "security-review---fix-issue",
    replaceDumpPath: true,
  });
});

testSkipIfWindows(
  "security review - edit and use knowledge",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.sendPrompt("tc=1");

    await po.previewPanel.selectPreviewMode("security");
    await po.page.getByRole("button", { name: "Edit Security Rules" }).click();
    await po.page
      .getByRole("textbox", { name: "# SECURITY_RULES.md\\n\\" })
      .click();
    await po.page
      .getByRole("textbox", { name: "# SECURITY_RULES.md\\n\\" })
      .fill("testing\nrules123");
    await po.page.getByRole("button", { name: "Save" }).click();

    await po.securityReview.clickRunSecurityReview();
    await po.snapshotServerDump("all-messages");
  },
);

test("security review - multi-select and fix issues", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=1");

  await po.previewPanel.selectPreviewMode("security");

  await po.page
    .getByRole("button", { name: "Run Security Review" })
    .first()
    .click();
  await po.chatActions.waitForChatCompletion();

  // Select the first two issues using individual checkboxes
  const checkboxes = po.page.getByRole("checkbox");
  // Skip the first checkbox (select all)
  await checkboxes.nth(1).click();
  await checkboxes.nth(2).click();

  // Wait for the "Fix X Issues" button to appear
  const fixSelectedButton = po.page.getByRole("button", {
    name: "Fix 2 Issues",
  });
  await fixSelectedButton.waitFor({ state: "visible" });

  // Click the fix selected button
  await fixSelectedButton.click();
  await expect(async () => {
    const text = await po.page.getByTestId("messages-list").textContent();
    expect(text).toMatch(
      /Please fix the following 2 security issues[\s\S]*Version 2:/,
    );
  }).toPass({ timeout: Timeout.MEDIUM });
  await po.snapshotMessages({ replaceDumpPath: true });
});

test("security review - reuses existing fix chat", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=1");

  await po.previewPanel.selectPreviewMode("security");
  await po.securityReview.clickRunSecurityReview();

  const closeButtons = po.page.getByLabel(/^Close tab:/);
  const messagesList = po.page.getByTestId("messages-list");
  const countFixPrompts = async () => {
    const text = await messagesList.textContent();
    return text?.match(/Please fix the following security issue/g)?.length ?? 0;
  };

  // While a fix is streaming, the row button is renamed to "Fixing Issue...",
  // so waiting for it to disappear means the fix stream has settled.
  const waitForFixStreamSettled = async () => {
    await expect(
      po.page.getByRole("button", { name: "Fixing Issue..." }),
    ).toHaveCount(0, { timeout: Timeout.MEDIUM });
  };

  // First click creates a fix chat and sends the fix prompt
  await po.page.getByRole("button", { name: "Fix Issue" }).first().click();
  await expect(async () => {
    expect(await countFixPrompts()).toBe(1);
  }).toPass({ timeout: Timeout.MEDIUM });
  await waitForFixStreamSettled();
  await expect(async () => {
    expect(await closeButtons.count()).toBe(3);
  }).toPass({ timeout: Timeout.MEDIUM });

  // Clicking the same Fix Issue again reopens the existing chat without
  // creating a new chat or sending another prompt
  await po.page.getByRole("button", { name: "Fix Issue" }).first().click();
  await expect(po.page.getByText("Opened existing fix chat")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
  expect(await closeButtons.count()).toBe(3);
  expect(await countFixPrompts()).toBe(1);

  // The toast's Re-run fix action sends the prompt again into the same chat.
  // Force the click because sonner toasts animate and never settle as "stable".
  await po.page.getByRole("button", { name: "Re-run fix" }).click({
    force: true,
  });
  await expect(async () => {
    expect(await countFixPrompts()).toBe(2);
  }).toPass({ timeout: Timeout.MEDIUM });
  await waitForFixStreamSettled();
  expect(await closeButtons.count()).toBe(3);
});

test("security review - multi-select reuses fix chat for same selection", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=1");

  await po.previewPanel.selectPreviewMode("security");
  await po.securityReview.clickRunSecurityReview();

  const closeButtons = po.page.getByLabel(/^Close tab:/);
  const checkboxes = po.page.getByRole("checkbox");

  // Fix the first two issues together
  await checkboxes.nth(1).click();
  await checkboxes.nth(2).click();
  await po.page.getByRole("button", { name: "Fix 2 Issues" }).click();
  await expect(async () => {
    const text = await po.page.getByTestId("messages-list").textContent();
    expect(text).toMatch(/Please fix the following 2 security issues/);
  }).toPass({ timeout: Timeout.MEDIUM });
  // The "Fixing N Issues..." button disappears once the fix stream settles
  await expect(
    po.page.getByRole("button", { name: /^Fixing \d+ Issue/ }),
  ).toHaveCount(0, { timeout: Timeout.MEDIUM });
  await expect(async () => {
    expect(await closeButtons.count()).toBe(3);
  }).toPass({ timeout: Timeout.MEDIUM });

  // Selecting the same set again reuses the existing fix chat
  await checkboxes.nth(1).click();
  await checkboxes.nth(2).click();
  await po.page.getByRole("button", { name: "Fix 2 Issues" }).click();
  await expect(po.page.getByText("Opened existing fix chat")).toBeVisible();
  expect(await closeButtons.count()).toBe(3);

  // A different selection creates a new fix chat
  await checkboxes.nth(3).click();
  await po.page.getByRole("button", { name: "Fix 1 Issue" }).click();
  await expect(async () => {
    const text = await po.page.getByTestId("messages-list").textContent();
    expect(text).toMatch(/Please fix the following security issue/);
  }).toPass({ timeout: Timeout.MEDIUM });
  await expect(
    po.page.getByRole("button", { name: "Fixing Issue..." }),
  ).toHaveCount(0, { timeout: Timeout.MEDIUM });
  await expect(async () => {
    expect(await closeButtons.count()).toBe(4);
  }).toPass({ timeout: Timeout.MEDIUM });
});

test("security review - fix issue reveals hidden chat panel", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=1");

  await po.previewPanel.selectPreviewMode("security");
  await po.securityReview.clickRunSecurityReview();

  // Hide the chat panel (the toggle lives in the preview toolbar)
  await po.previewPanel.selectPreviewMode("preview");
  await po.page.getByTestId("preview-toggle-chat-panel-button").click();
  await expect(po.page.getByTestId("messages-list")).not.toBeVisible();

  // Clicking Fix Issue should reveal the chat panel with the fix chat
  await po.previewPanel.selectPreviewMode("security");
  await po.page.getByRole("button", { name: "Fix Issue" }).first().click();
  await expect(po.page.getByTestId("messages-list")).toBeVisible();
  await po.chatActions.waitForChatCompletion();
});

test("security review - creates chat tabs", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=1");

  await po.previewPanel.selectPreviewMode("security");

  // Initial tab count should be 1 (the first chat)
  const closeButtons = po.page.getByLabel(/^Close tab:/);
  await expect(async () => {
    const count = await closeButtons.count();
    expect(count).toBe(1);
  }).toPass({ timeout: Timeout.MEDIUM });

  // Run security review creates a new chat
  await po.page
    .getByRole("button", { name: "Run Security Review" })
    .first()
    .click();
  await po.chatActions.waitForChatCompletion();

  // Tab count should increase to 2
  await expect(async () => {
    const count = await closeButtons.count();
    expect(count).toBe(2);
  }).toPass({ timeout: Timeout.MEDIUM });

  // Click Fix Issue creates another chat
  await po.page.getByRole("button", { name: "Fix Issue" }).first().click();
  await po.chatActions.waitForChatCompletion();

  // Tab count should increase to 3
  await expect(async () => {
    const count = await closeButtons.count();
    expect(count).toBe(3);
  }).toPass({ timeout: Timeout.MEDIUM });
});
