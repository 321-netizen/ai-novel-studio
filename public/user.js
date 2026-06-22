const modeTabs = document.querySelectorAll(".mode-tab");
const modePanels = document.querySelectorAll(".mode-panel");
const assistForm = document.querySelector("#assist-form");
const autoForm = document.querySelector("#auto-form");
const statusBox = document.querySelector("#status-box");
const resultBox = document.querySelector("#result-box");
const resultMeta = document.querySelector("#result-meta");
const configChip = document.querySelector("#config-chip");
const saveButton = document.querySelector("#save-btn");
const exportButton = document.querySelector("#export-btn");
const nextChapterButton = document.querySelector("#next-chapter-btn");
const continueResultButton = document.querySelector("#continue-result-btn");
const rewriteResultButton = document.querySelector("#rewrite-result-btn");
const savedList = document.querySelector("#saved-list");
const workspaceProvider = document.querySelector("#workspace-provider");
const workspaceModel = document.querySelector("#workspace-model");
const workspaceCount = document.querySelector("#workspace-count");
const editionTabs = document.querySelectorAll(".edition-tab");
const editionChip = document.querySelector("#edition-chip");
const editionNote = document.querySelector("#edition-note");
const editionModal = document.querySelector("#edition-modal");
const editionModalConfirm = document.querySelector("#edition-modal-confirm");
const editionModalCancel = document.querySelector("#edition-modal-cancel");
const editionModalClose = document.querySelector("#edition-modal-close");
const editionModalTitle = document.querySelector("#edition-modal-title");
const editionModalPrice = document.querySelector("#edition-modal-price");
const editionModalCopy = document.querySelector("#edition-modal-copy");
const editionModalFootnote = document.querySelector("#edition-modal-footnote");

let latestPayload = null;
let latestGenerationResult = null;
let selectedWorkId = null;
let savedWorksCache = [];
let currentEdition = "basic";
let pendingEdition = null;
let currentUser = null;

function setAdminOnlyVisibility(isAdmin) {
  document.querySelectorAll(".admin-only-link").forEach((node) => {
    node.classList.toggle("is-visible", Boolean(isAdmin));
  });
}

function setActiveMode(mode) {
  modeTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.modeTarget === mode);
  });

  modePanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.modePanel === mode);
  });
}

function setStatus(message, isLoading = false) {
  statusBox.textContent = message;
  statusBox.classList.toggle("loading", isLoading);
}

function setResult(text, meta) {
  resultBox.textContent = text;
  resultMeta.textContent = meta;
}

function redirectToLogin(reason = "登录状态已失效，请重新登录。") {
  window.alert(reason);
  window.location.href = "/auth.html";
}

async function parseJsonResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 || data.error === "请先登录") {
    redirectToLogin();
    throw new Error("请先登录");
  }
  return data;
}

function getEditionLabel(edition) {
  return edition === "pro" ? "专业版" : "基础版";
}

function getEditionDescription(edition) {
  return edition === "pro"
    ? "专业版已开启小说记忆，更适合长篇连载、人物追踪和伏笔延续。"
    : "基础版不带小说记忆，更轻量，适合短篇出稿和低价套餐。";
}

function userHasProAccess() {
  return Boolean(currentUser && (currentUser.role === "admin" || currentUser.subscription === "pro"));
}

function setActiveEdition(edition) {
  currentEdition = edition === "pro" ? "pro" : "basic";
  editionTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.edition === currentEdition);
  });

  if (editionChip) {
    editionChip.classList.remove("basic", "pro");
    editionChip.classList.add(currentEdition);
    editionChip.textContent = `当前为${getEditionLabel(currentEdition)}`;
  }

  if (editionNote) {
    editionNote.textContent = getEditionDescription(currentEdition);
  }
}

function openEditionModal() {
  if (!editionModal) {
    return;
  }

  if (editionModalTitle && editionModalPrice && editionModalCopy && editionModalFootnote && editionModalConfirm) {
    if (userHasProAccess()) {
      editionModalTitle.textContent = "切换到专业版创作";
      editionModalPrice.textContent = "你的账号已开通专业版";
      editionModalCopy.textContent = "你可以直接开启小说记忆，用更稳定的方式继续长篇创作、人物追踪和伏笔延续。";
      editionModalFootnote.textContent = "点击下方按钮后，当前创作台会立即切换到专业版。";
      editionModalConfirm.textContent = "切换到专业版";
    } else {
      editionModalTitle.textContent = "开启专业版小说记忆";
      editionModalPrice.textContent = "专业版建议售价：79 元 / 月";
      editionModalCopy.textContent = "专业版更适合长篇连载。系统会自动记录人物状态、剧情时间线、关键道具和未回收伏笔，后续续写时不容易忘前文。";
      editionModalFootnote.textContent = "点击“立即开通专业版”后，会先提交开通申请，由管理员手动为你的账号开通。";
      editionModalConfirm.textContent = currentUser?.upgradeRequestedAt ? "已提交开通申请" : "立即开通专业版";
    }
  }

  editionModal.classList.add("is-open");
  editionModal.setAttribute("aria-hidden", "false");
}

function closeEditionModal() {
  if (!editionModal) {
    return;
  }

  editionModal.classList.remove("is-open");
  editionModal.setAttribute("aria-hidden", "true");
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString("zh-CN") : "暂无时间";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setConfigStatus({ hasApiKey, model, provider }) {
  configChip.classList.remove("connected", "disconnected");
  if (hasApiKey) {
    configChip.classList.add("connected");
    configChip.textContent = `已接入真实模型：${provider} / ${model}`;
    workspaceProvider.textContent = provider;
    workspaceModel.textContent = model;
    return;
  }

  configChip.classList.add("disconnected");
  configChip.textContent = `当前为演示模式，未检测到 API Key。默认模型预设：${provider} / ${model}`;
  workspaceProvider.textContent = "演示模式";
  workspaceModel.textContent = `${provider} / ${model}`;
}

function collectFormData(form) {
  const formData = new FormData(form);
  return Object.fromEntries(formData.entries());
}

function enableResultActions(enabled) {
  saveButton.disabled = !enabled;
  exportButton.disabled = !enabled;
  nextChapterButton.disabled = !enabled;
  continueResultButton.disabled = !enabled;
  rewriteResultButton.disabled = !enabled;
}

function focusAssistEditor(action, direction) {
  setActiveMode("assist");
  assistForm.querySelector("[name='action']").value = action;
  assistForm.querySelector("[name='sourceText']").value = latestGenerationResult.result || "";
  assistForm.querySelector("[name='direction']").value = direction;
  assistForm.querySelector("[name='targetLength']").value =
    latestPayload?.chapterLength ? `约 ${latestPayload.chapterLength} 字` : "约 800 字";
  assistForm.querySelector("[name='genre']").value =
    latestPayload?.genre || assistForm.querySelector("[name='genre']").value;
  assistForm.querySelector("[name='style']").value =
    latestPayload?.style || assistForm.querySelector("[name='style']").value;
  assistForm.scrollIntoView({ behavior: "smooth", block: "start" });
  assistForm.querySelector("[name='direction']").focus();
}

function renderSessionBar(user) {
  const sessionBar = document.createElement("div");
  sessionBar.className = "session-bar";
  sessionBar.innerHTML = `
    <span>当前登录：<strong>${user.email}</strong></span>
    <button id="logout-btn" class="ghost-btn small-btn" type="button">退出登录</button>
  `;
  const target = document.querySelector("#session-slot") || document.querySelector(".hero-copy");
  target.appendChild(sessionBar);
  sessionBar.querySelector("#logout-btn").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/auth.html";
  });
}

function setupPromptExamples() {
  document.querySelectorAll("[data-fill-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      const prompt = button.dataset.fillPrompt || "";
      const premiseInput = autoForm.querySelector("[name='premise']");
      premiseInput.value = prompt;
      premiseInput.focus();
      setActiveMode("auto");
    });
  });
}

async function requireUserSession() {
  const response = await fetch("/api/auth/me");
  const data = await response.json();
  if (!response.ok || !data.user) {
    window.location.href = "/auth.html";
    throw new Error("未登录");
  }
  currentUser = data.user;
  setAdminOnlyVisibility(data.user.role === "admin");
  renderSessionBar(data.user);
}

async function submitPayload(payload, triggerButton, pendingText) {
  triggerButton.disabled = true;
  enableResultActions(false);
  latestPayload = null;
  latestGenerationResult = null;
  setStatus(pendingText, true);
  setResult("正在生成内容，请稍候……", "请求已发出。");

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(data.error || "请求失败");
    }

    latestPayload = payload;
    latestGenerationResult = data;

    const meta = [
      getEditionLabel(payload.edition),
      payload.mode === "assist" ? "灵感辅助型" : "全自动生成型",
      data.demo ? "当前为演示模式输出" : "当前为真实模型输出"
    ].join(" · ");

    setStatus("生成完成");
    setResult(data.result, meta);
    enableResultActions(true);
  } catch (error) {
    setStatus("生成失败");
    setResult(
      `请求失败：${error.message}\n\n如果是 DeepSeek 返回错误，通常是 API Key、模型名、余额、限流或接口格式问题。\n如果只是空响应，可能是模型临时没返回内容。`,
      "接口返回错误。"
    );
  } finally {
    triggerButton.disabled = false;
  }
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function sanitizeFileName(name) {
  return String(name || "novel")
    .replace(/[\\/:*?"<>|]/g, "_")
    .slice(0, 40);
}

function normalizeCompareText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldAttachContinuityMemory(sourceText) {
  if (currentEdition !== "pro") {
    return false;
  }

  const memory = latestGenerationResult && latestGenerationResult.memory;
  const currentResult = normalizeCompareText(latestGenerationResult && latestGenerationResult.result);
  const currentSource = normalizeCompareText(sourceText);

  if (!memory || !currentResult || !currentSource) {
    return false;
  }

  if (currentSource === currentResult) {
    return true;
  }

  const compareLength = Math.min(180, currentResult.length, currentSource.length);
  if (compareLength < 80) {
    return false;
  }

  return currentSource.slice(0, compareLength) === currentResult.slice(0, compareLength);
}

async function saveCurrentWork() {
  if (!latestPayload || !latestGenerationResult) {
    return;
  }

  saveButton.disabled = true;
  try {
    const response = await fetch("/api/works", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        input: latestPayload,
        generationResult: latestGenerationResult
      })
    });

    const data = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(data.error || "保存失败");
    }

    setStatus("作品已保存");
    await loadSavedWorks();
  } catch (error) {
    setStatus("保存失败");
    resultMeta.textContent = `保存失败：${error.message}`;
  } finally {
    saveButton.disabled = false;
  }
}

function renderSavedWorks(works) {
  savedWorksCache = Array.isArray(works) ? works : [];
  workspaceCount.textContent = `${works.length} 篇`;

  if (!works.length) {
    selectedWorkId = null;
    savedList.innerHTML = '<p class="empty-copy">你还没有保存过作品。</p>';
    return;
  }

  savedList.innerHTML = works
    .map((work) => `
      <article class="saved-item saved-item-shell${selectedWorkId === work.id ? " is-active" : ""}">
        <button
          class="saved-item-button"
          type="button"
          data-work-id="${escapeHtml(work.id)}"
        >
          <div class="saved-item-head">
            <strong>${escapeHtml(work.title)}</strong>
            <span>${work.mode === "assist" ? "辅助型" : "自动型"} · ${getEditionLabel(work.edition)}</span>
          </div>
          <p>${escapeHtml(work.excerpt || "暂无摘要")}</p>
          <div class="saved-item-meta">
            <span>${escapeHtml(String(work.wordCount || 0))} 字</span>
            <span>${escapeHtml(formatDate(work.createdAt))}</span>
          </div>
        </button>
        <div class="saved-item-actions">
          <button
            class="ghost-btn small-btn saved-delete-btn"
            type="button"
            data-delete-work-id="${escapeHtml(work.id)}"
          >
            删除
          </button>
        </div>
      </article>
    `)
    .join("");

  savedList.querySelectorAll("[data-work-id]").forEach((button) => {
    button.addEventListener("click", () => {
      loadSavedWorkDetail(button.dataset.workId);
    });
  });

  savedList.querySelectorAll("[data-delete-work-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      await deleteSavedWork(button.dataset.deleteWorkId);
    });
  });
}

async function loadSavedWorkDetail(workId) {
  if (!workId) {
    return;
  }

  selectedWorkId = workId;
  renderSavedWorks(savedWorksCache);
  setStatus("正在打开已保存作品…", true);

  try {
    const response = await fetch(`/api/works/${encodeURIComponent(workId)}`);
    const data = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(data.error || "读取作品详情失败");
    }

    const work = data.work;
    const edition = work.edition || work.input?.edition || (work.memory ? "pro" : "basic");
    setActiveEdition(edition === "pro" && !userHasProAccess() ? "basic" : edition);
    latestPayload = work.input || null;
    latestGenerationResult = {
      result: work.content || "",
      plan: work.plan || null,
      memory: work.memory || null,
      demo: work.demo
    };

    const meta = [
      "已打开已保存作品",
      getEditionLabel(edition),
      work.mode === "assist" ? "灵感辅助型" : "全自动生成型",
      `${work.wordCount || 0} 字`,
      formatDate(work.createdAt)
    ].join(" · ");

    setStatus("已打开保存作品");
    setResult(work.content || "这篇作品暂无正文。", meta);
    enableResultActions(Boolean(work.content));
    resultBox.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    setStatus("打开作品失败");
    resultMeta.textContent = `打开失败：${error.message}`;
  }
}

async function deleteSavedWork(workId) {
  if (!workId) {
    return;
  }

  const confirmed = window.confirm("确定要删除这篇作品吗？删除后不可恢复。");
  if (!confirmed) {
    return;
  }

  setStatus("正在删除作品…", true);

  try {
    const response = await fetch(`/api/works/${encodeURIComponent(workId)}`, {
      method: "DELETE"
    });
    const data = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(data.error || "删除失败");
    }

    if (selectedWorkId === workId) {
      selectedWorkId = null;
      latestPayload = null;
      latestGenerationResult = null;
      enableResultActions(false);
      setResult("这篇作品已删除。输入一句话设定后，这里会输出完整小说内容。", "你可以重新生成，或点开其他已保存作品。");
    }

    setStatus("作品已删除");
    await loadSavedWorks();
  } catch (error) {
    setStatus("删除失败");
    resultMeta.textContent = `删除失败：${error.message}`;
  }
}

async function loadSavedWorks() {
  try {
    const response = await fetch("/api/works");
    const data = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(data.error || "读取失败");
    }
    renderSavedWorks(data.works || []);
  } catch (error) {
    if (error.message.includes("请先登录")) return;
    savedList.innerHTML = '<p class="empty-copy">读取作品库失败。</p>';
  }
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "读取配置失败");
    }
    setConfigStatus(data);
  } catch (error) {
    configChip.classList.remove("connected");
    configChip.classList.add("disconnected");
    configChip.textContent = "无法读取当前模型连接状态。";
  }
}

modeTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    setActiveMode(tab.dataset.modeTarget);
  });
});

assistForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = assistForm.querySelector("button[type='submit']");
  const sourceText = assistForm.querySelector("[name='sourceText']").value;
  const payload = {
    mode: "assist",
    edition: currentEdition,
    ...collectFormData(assistForm),
    continuityMemory: currentEdition === "pro" && shouldAttachContinuityMemory(sourceText)
      ? latestGenerationResult.memory
      : null
  };

  await submitPayload(payload, submitButton, "正在生成辅助内容");
});

autoForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = autoForm.querySelector("button[type='submit']");
  const payload = {
    mode: "auto",
    edition: currentEdition,
    ...collectFormData(autoForm)
  };

  await submitPayload(payload, submitButton, "正在规划并生成完整小说");
});

saveButton.addEventListener("click", saveCurrentWork);

exportButton.addEventListener("click", () => {
  if (!latestGenerationResult) {
    return;
  }

  const filenameBase =
    (latestGenerationResult.plan && latestGenerationResult.plan.title) ||
    (latestPayload && latestPayload.premise) ||
    (latestPayload && latestPayload.action) ||
    "ai_novel";

  downloadTextFile(`${sanitizeFileName(filenameBase)}.txt`, latestGenerationResult.result);
});

nextChapterButton.addEventListener("click", async () => {
  if (!latestGenerationResult) {
    return;
  }

  const payload = {
    mode: "assist",
    edition: currentEdition,
    action: "continue",
    sourceText: latestGenerationResult.result,
    genre: latestPayload?.genre || "",
    targetLength: latestPayload?.chapterLength ? `约 ${latestPayload.chapterLength} 字` : "约 800 字",
    style: latestPayload?.style || "",
    direction: "请直接续写下一章节，延续当前剧情、人物状态和叙事节奏，并自然承接上一章结尾。",
    constraints: latestPayload?.constraints || "",
    continuityMemory: currentEdition === "pro" ? (latestGenerationResult.memory || null) : null
  };

  await submitPayload(payload, nextChapterButton, "正在继续生成下一章节");
});

continueResultButton.addEventListener("click", () => {
  if (!latestGenerationResult) {
    return;
  }

  focusAssistEditor("continue", "请延续当前结果的节奏和人物状态，继续写下一章节。");
  setStatus("已带入灵感辅助");
  resultMeta.textContent = "当前结果已带入辅助型续写。";
});

rewriteResultButton.addEventListener("click", () => {
  if (!latestGenerationResult) {
    return;
  }

  focusAssistEditor("rewrite", "请保留主线剧情和人物关系，优化这段内容的表达、节奏和细节。");
  setStatus("已带入灵感辅助");
  resultMeta.textContent = "当前结果已带入辅助型改写。";
});

editionTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    if (tab.dataset.edition === "pro" && currentEdition !== "pro") {
      pendingEdition = "pro";
      openEditionModal();
      return;
    }

    pendingEdition = null;
    setActiveEdition(tab.dataset.edition);
  });
});

editionModalConfirm?.addEventListener("click", () => {
  if (userHasProAccess()) {
    setActiveEdition(pendingEdition || "pro");
    pendingEdition = null;
    closeEditionModal();
    return;
  }

  if (currentUser?.upgradeRequestedAt) {
    setStatus("已提交开通申请");
    resultMeta.textContent = "管理员审核后会为你的账号开通专业版。";
    closeEditionModal();
    return;
  }

  fetch("/api/upgrade-request", {
    method: "POST"
  })
    .then(async (response) => {
      const data = await parseJsonResponse(response);
      if (!response.ok) {
        throw new Error(data.error || "提交开通申请失败");
      }
      currentUser = data.user || currentUser;
      setStatus("开通申请已提交");
      resultMeta.textContent = "管理员后台已经可以看到你的专业版申请，开通后即可切换使用。";
      closeEditionModal();
    })
    .catch((error) => {
      setStatus("提交申请失败");
      resultMeta.textContent = `提交失败：${error.message}`;
    });
});

editionModalCancel?.addEventListener("click", () => {
  pendingEdition = null;
  setActiveEdition("basic");
  closeEditionModal();
});

editionModalClose?.addEventListener("click", () => {
  pendingEdition = null;
  closeEditionModal();
});

editionModal?.addEventListener("click", (event) => {
  const target = event.target;
  if (target instanceof HTMLElement && target.dataset.closeEditionModal === "true") {
    pendingEdition = null;
    closeEditionModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && editionModal?.classList.contains("is-open")) {
    pendingEdition = null;
    closeEditionModal();
  }
});

enableResultActions(false);
setActiveEdition(currentEdition);
setupPromptExamples();

Promise.resolve()
  .then(() => requireUserSession())
  .then(() => loadConfig())
  .then(() => loadSavedWorks())
  .catch(() => {});
