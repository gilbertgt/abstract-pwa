const apiKeyInput = document.getElementById("apiKeyInput");
const modelSelect = document.getElementById("modelSelect");
const promptPresetSelect = document.getElementById("promptPresetSelect");
const manualTitleInput = document.getElementById("manualTitleInput");
const manualTextInput = document.getElementById("manualTextInput");
const summarizeTextButton = document.getElementById("summarizeTextButton");
const clearButton = document.getElementById("clearButton");
const statusPill = document.getElementById("statusPill");
const statusBanner = document.getElementById("statusBanner");
const statusLabel = document.getElementById("statusLabel");
const statusText = document.getElementById("statusText");
const offlineHint = document.getElementById("offlineHint");
const resultMeta = document.getElementById("resultMeta");
const resultTitle = document.getElementById("resultTitle");
const resultSummary = document.getElementById("resultSummary");
const resultStateCard = document.getElementById("resultStateCard");
const resultStateLabel = document.getElementById("resultStateLabel");
const resultStateText = document.getElementById("resultStateText");
const keyPoints = document.getElementById("keyPoints");
const mainTakeaways = document.getElementById("mainTakeaways");
const keyFacts = document.getElementById("keyFacts");
const actionItems = document.getElementById("actionItems");

const STORAGE_KEY = "abstract-pwa-settings";
const RESULT_KEY = "abstract-pwa-last-result";
const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";
const DEFAULT_MODEL = "deepseek-chat";
const DEFAULT_PROMPT_PRESET = "bullet_points_first";
const STATUS_PILL_TEXT = {
  idle: "待整理",
  loading: "整理中",
  success: "已更新",
  warning: "離線中",
  error: "需要留意"
};
const PROMPT_PRESETS = {
  bullet_points_first: {
    label: "請用條列式整理重點，先給結論，再列出 5 到 10 個關鍵要點。",
    instruction: "請用條列式整理重點，先給結論，再列出 5 到 10 個關鍵要點。"
  },
  plain_language: {
    label: "請用白話方式整理，讓非專業讀者也能快速看懂。",
    instruction: "請用白話方式整理，讓非專業讀者也能快速看懂。"
  },
  summary_actions: {
    label: "請整理成「重點摘要 + 可執行行動項」，行動項請具體。",
    instruction: "請整理成「重點摘要 + 可執行行動項」，行動項請具體。"
  },
  brief_then_dive: {
    label: "請先做精簡摘要，再補充值得深入看的爭議、限制或疑點。",
    instruction: "請先做精簡摘要，再補充值得深入看的爭議、限制或疑點。"
  },
  three_to_five_sentences: {
    label: "請先用 3 到 5 句做摘要，再補充最重要的關鍵點。",
    instruction: "請先用 3 到 5 句做摘要，再補充最重要的關鍵點。"
  }
};

const appState = {
  status: {
    tone: "idle",
    label: "目前狀態",
    message: "尚未整理任何內容。"
  },
  resultState: {
    tone: "idle",
    label: "結果狀態",
    message: "等待你送出第一筆內容，這裡會同步說明結果目前的狀態。"
  }
};

init();
summarizeTextButton.addEventListener("click", handleSummarizeText);
clearButton.addEventListener("click", handleClear);
promptPresetSelect.addEventListener("change", handlePromptPresetChange);
apiKeyInput.addEventListener("input", persistSettings);
modelSelect.addEventListener("change", persistSettings);
manualTitleInput.addEventListener("input", persistSettings);
manualTextInput.addEventListener("input", persistSettings);
window.addEventListener("online", updateOnlineState);
window.addEventListener("offline", updateOnlineState);

async function init() {
  clearResult();
  restoreSettings();
  restoreResult();
  renderStatus();
  renderResultState();
  updateOnlineState();
  await registerServiceWorker();
}

function restoreSettings() {
  const saved = parseJson(localStorage.getItem(STORAGE_KEY), {});
  apiKeyInput.value = saved.apiKey || "";
  modelSelect.value = saved.model || DEFAULT_MODEL;
  const normalizedPromptPreset = normalizePromptPreset(saved.promptPreset);
  promptPresetSelect.value = normalizedPromptPreset;
  manualTitleInput.value = saved.title || "";
  manualTextInput.value = saved.text || "";

  if (saved.promptPreset !== normalizedPromptPreset) {
    persistSettings();
  }
}

function restoreResult() {
  const savedResult = parseJson(localStorage.getItem(RESULT_KEY), null);
  if (!savedResult) {
    return;
  }

  renderResult(savedResult);
  setStatus("已載入上一次整理結果。", {
    tone: "success",
    label: "本機結果"
  });
  setResultState("目前顯示的是最近一次保存在這台裝置上的整理結果。", {
    tone: "success",
    label: "結果已還原"
  });
}

async function handleSummarizeText() {
  const text = manualTextInput.value.trim();
  const apiKey = apiKeyInput.value.trim();

  if (!text) {
    setStatus("請先貼上要整理的文字內容。", {
      tone: "error",
      label: "缺少內容"
    });
    manualTextInput.focus();
    return;
  }

  if (!apiKey) {
    setStatus("請先輸入 DeepSeek API Key。", {
      tone: "error",
      label: "缺少設定"
    });
    apiKeyInput.focus();
    return;
  }

  if (!navigator.onLine) {
    setStatus("目前離線中，無法呼叫 DeepSeek。請先連上網路再試一次。", {
      tone: "warning",
      label: "連線狀態"
    });
    setResultState("離線時仍可查看先前結果，但新的整理作業會先暫停。", {
      tone: "warning",
      label: "等待連線"
    });
    return;
  }

  const model = modelSelect.value || DEFAULT_MODEL;
  const title = manualTitleInput.value.trim();
  const promptPreset = normalizePromptPreset(promptPresetSelect.value);
  promptPresetSelect.value = promptPreset;
  persistSettings();
  setBusy(true, "正在進行深入條列整理...");
  setResultState("正在呼叫 DeepSeek 整理內容，完成後會更新下方所有結果區塊。", {
    tone: "loading",
    label: "結果同步中"
  });

  try {
    const result = await summarizeManualText({ text, apiKey, model, title, promptPreset });
    localStorage.setItem(RESULT_KEY, JSON.stringify(result));
    renderResult(result);
    setStatus("整理完成。已更新為深入條列整理結果。", {
      tone: "success",
      label: "最近狀態"
    });
    setResultState("總覽、重點、結論、事實與行動項目都已更新為最新結果。", {
      tone: "success",
      label: "結果已更新"
    });
  } catch (error) {
    setStatus(error.message || "整理失敗，請稍後再試。", {
      tone: "error",
      label: "整理失敗"
    });
    setResultState("這次整理沒有完成，你可以檢查 API Key、網路狀態或原始內容後再試一次。", {
      tone: "error",
      label: "等待重試"
    });
  } finally {
    setBusy(false);
  }
}

function handleClear() {
  manualTitleInput.value = "";
  manualTextInput.value = "";
  localStorage.removeItem(RESULT_KEY);
  persistSettings();
  clearResult();
  setStatus("已清空輸入內容與暫存結果。", {
    tone: "idle",
    label: "工作區已重置"
  });
  setResultState("目前沒有保存中的整理結果。貼上新內容後即可重新開始。", {
    tone: "idle",
    label: "等待新結果"
  });
}

function handlePromptPresetChange() {
  const normalizedPromptPreset = normalizePromptPreset(promptPresetSelect.value);
  promptPresetSelect.value = normalizedPromptPreset;
  persistSettings();
}

async function summarizeManualText({ text, apiKey, model, title, promptPreset }) {
  const blocks = splitManualText(text).map((chunk, index) => ({
    id: `manual-${index + 1}`,
    tag: "manual",
    text: chunk,
    score: 100,
    selector: "manual-input",
    rect: null
  }));

  const payload = {
    pageMeta: {
      title: title || "手動貼上文字",
      url: "",
      lang: "zh-Hant",
      contentMode: "article"
    },
    blocks
  };

  const response = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: buildSystemPrompt(promptPreset) },
        { role: "user", content: buildUserPrompt(payload, promptPreset) }
      ]
    })
  });

  if (!response.ok) {
    const detail = await safeReadText(response);
    throw new Error(`DeepSeek API 錯誤（${response.status}）${detail ? `：${detail}` : ""}`);
  }

  const data = await response.json();
  const rawContent = data?.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error("DeepSeek 沒有回傳可用內容。");
  }

  const analysis = normalizeAnalysis(parseJsonResponse(rawContent));
  const promptPresetMeta = getPromptPresetMeta(promptPreset);
  return normalizeStoredResult({
    createdAt: new Date().toISOString(),
    sourceType: "manual",
    model,
    promptPreset: promptPresetMeta.promptPreset,
    promptPresetLabel: promptPresetMeta.promptPresetLabel,
    promptStyleLabel: promptPresetMeta.promptPresetLabel,
    pageMeta: payload.pageMeta,
    blocks: [],
    analysis
  });
}

function buildSystemPrompt(promptPreset) {
  const preset = resolvePromptPreset(promptPreset);
  return [
    "你是專門整理內容的繁體中文研究助理。",
    "第一優先是輸出有效 JSON，不能包含 markdown 程式碼區塊、前言、後記或額外說明。",
    "第二優先是所有輸出欄位、句子、標題、摘要、條列都必須使用自然且完整的繁體中文。禁止輸出簡體中文。若原文是英文或簡體中文，請將整理結果改寫成繁體中文。",
    "第三優先是輸出深入條列整理，而不是簡易摘要、散文式心得或空泛導讀。",
    "第四優先是嚴格忠於提供內容，避免幻覺補完。",
    "不可補寫原文未明說的背景、因果、立場、動機或結論。",
    "不可把常識、猜測、模型推論或外部知識當成原文事實。",
    "若資訊不足，只能保守描述為文中未明確說明，或直接省略，不可自行填空。",
    "若內容存在不確定、衝突或分歧，必須如實呈現，不可強行統整為單一結論。",
    "可保留必要的原文專有名詞，但主要敘述必須是繁體中文。",
    "每個欄位請避免重複彼此內容，避免反覆講同一件事。",
    `這次整理的風格偏好是：${preset.instruction}`,
    "這次來源是使用者手動貼上的文字。",
    "請整理出較深入的脈絡、主要觀點、關鍵事實與整體結論，但不要超出原文內容。"
  ].join(" ");
}

function buildUserPrompt(payload, promptPreset) {
  const preset = resolvePromptPreset(promptPreset);
  return [
    "請把下面的手動貼上文字整理成繁體中文深入條列筆記。",
    "請只輸出 JSON，欄位結構必須完全符合下列格式：",
    "{",
    '  "title": string,',
    '  "summary": string,',
    '  "key_points": string[],',
    '  "main_takeaways": string[],',
    '  "key_facts": string[],',
    '  "action_items": string[]',
    "}",
    "輸出規則：",
    "1. title 要精準概括內容主題。",
    "2. summary 要寫成較完整的導讀型摘要，說清楚主題、背景與重點，不要只有兩三句空話。",
    "3. key_points 要整理主要論點與其脈絡，每點都要有資訊量，不要只寫標題式短句。",
    "4. main_takeaways 要提煉更高層的整體結論、意義或判斷，但不能超出原文。",
    "5. key_facts 要保留具體資訊、數字、條件、限制、事件或明確補充。",
    "6. action_items 只有在內容明確存在建議、做法、後續步驟或可執行方向時才輸出，否則回傳空陣列。",
    "7. 每個陣列欄位盡量控制在 3 到 6 點，每點用完整句子表達，但避免過長段落。",
    "8. 不可重複 summary 內容，也不要讓不同欄位反覆講同一件事。",
    "9. 若原文沒有提供足夠依據，就不要自行補完。",
    `整理方式：${preset.label}`,
    `來源標題：${payload.pageMeta.title || ""}`,
    payload.blocks.map((block) => block.text).join("\n\n")
  ].join("\n");
}

function parseJsonResponse(rawContent) {
  const cleaned = rawContent.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("DeepSeek 回傳的內容不是有效 JSON。");
  }
}

function normalizeAnalysis(parsed) {
  const normalizeItems = (value) => {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => {
        if (typeof item === "string") {
          return item.trim();
        }
        if (item && typeof item === "object") {
          return String(item.text || "").trim();
        }
        return "";
      })
      .filter(Boolean);
  };

  return {
    title: String(parsed?.title || "").trim() || "手動整理結果",
    summary: String(parsed?.summary || "").trim() || "模型沒有回傳摘要。",
    key_points: normalizeItems(parsed?.key_points),
    main_takeaways: normalizeItems(parsed?.main_takeaways),
    key_facts: normalizeItems(parsed?.key_facts),
    action_items: normalizeItems(parsed?.action_items)
  };
}

function normalizeStoredResult(result) {
  const promptPresetMeta = getPromptPresetMeta(result?.promptPreset);
  return {
    createdAt: String(result?.createdAt || new Date().toISOString()),
    sourceType: String(result?.sourceType || "manual"),
    model: String(result?.model || DEFAULT_MODEL),
    promptPreset: promptPresetMeta.promptPreset,
    promptPresetLabel: String(result?.promptPresetLabel || result?.promptStyleLabel || promptPresetMeta.promptPresetLabel),
    promptStyleLabel: String(result?.promptStyleLabel || result?.promptPresetLabel || promptPresetMeta.promptPresetLabel),
    pageMeta: {
      title: String(result?.pageMeta?.title || "手動貼上文字"),
      url: String(result?.pageMeta?.url || ""),
      lang: String(result?.pageMeta?.lang || "zh-Hant"),
      contentMode: String(result?.pageMeta?.contentMode || "article")
    },
    blocks: Array.isArray(result?.blocks) ? result.blocks : [],
    analysis: normalizeAnalysis(result?.analysis || {})
  };
}

function splitManualText(text) {
  return text
    .split(/\n{2,}/)
    .map((chunk) => chunk.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .reduce((accumulator, chunk) => {
      if (!accumulator.length) {
        accumulator.push(chunk);
        return accumulator;
      }

      const lastIndex = accumulator.length - 1;
      if (accumulator[lastIndex].length + chunk.length + 2 <= 1800) {
        accumulator[lastIndex] = `${accumulator[lastIndex]}\n\n${chunk}`;
      } else {
        accumulator.push(chunk);
      }
      return accumulator;
    }, []);
}

function renderResult(result) {
  const normalizedResult = normalizeStoredResult(result);
  const { analysis } = normalizedResult;

  resultTitle.textContent = analysis.title || "手動整理結果";
  resultSummary.textContent = analysis.summary || "模型沒有回傳摘要。";
  renderEditorialList(keyPoints, analysis.key_points, "目前還沒有可以整理成重點列表的內容。");
  renderTakeaways(mainTakeaways, analysis.main_takeaways, "目前還沒有足夠明確的整體結論。");
  renderCardList(keyFacts, analysis.key_facts, "目前沒有抽出明確的關鍵事實。", "fact-card");
  renderCardList(actionItems, analysis.action_items, "原文中沒有明確的建議、後續步驟或可執行方向。", "action-card");

  const promptLabel = normalizedResult.promptPresetLabel || normalizedResult.promptStyleLabel || getPromptPresetMeta(normalizedResult.promptPreset).promptPresetLabel;
  renderMetaChips(resultMeta, [
    "手動貼文字",
    promptLabel,
    normalizedResult.model,
    `更新於 ${formatTime(normalizedResult.createdAt)}`
  ]);
}

function clearResult() {
  resultTitle.textContent = "尚無結果";
  resultSummary.textContent = "輸入文字並執行整理後，這裡會顯示繁體中文的深入條列整理結果。";
  resultMeta.innerHTML = "";
  renderEditorialList(keyPoints, [], "目前還沒有可以整理成重點列表的內容。");
  renderTakeaways(mainTakeaways, [], "目前還沒有足夠明確的整體結論。");
  renderCardList(keyFacts, [], "目前沒有抽出明確的關鍵事實。", "fact-card");
  renderCardList(actionItems, [], "原文中沒有明確的建議、後續步驟或可執行方向。", "action-card");
}

function renderEditorialList(container, items, emptyText) {
  container.innerHTML = "";
  const values = sanitizeItems(items);

  if (!values.length) {
    container.appendChild(createEmptyState(emptyText));
    return;
  }

  const list = document.createElement("ol");
  list.className = "editorial-list";
  values.forEach((item) => {
    const listItem = document.createElement("li");
    listItem.textContent = item;
    list.appendChild(listItem);
  });
  container.appendChild(list);
}

function renderTakeaways(container, items, emptyText) {
  container.innerHTML = "";
  const values = sanitizeItems(items);

  if (!values.length) {
    container.appendChild(createEmptyState(emptyText));
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "takeaway-block";

  const primary = document.createElement("article");
  primary.className = "takeaway-card";

  const label = document.createElement("p");
  label.className = "section-label";
  label.textContent = "核心結論";

  const copy = document.createElement("p");
  copy.className = "takeaway-copy";
  copy.textContent = values[0];

  primary.append(label, copy);
  wrapper.appendChild(primary);

  if (values.length > 1) {
    const list = document.createElement("ul");
    list.className = "stack-list";
    values.slice(1).forEach((item) => {
      const listItem = document.createElement("li");
      listItem.className = "takeaway-secondary";
      listItem.textContent = item;
      list.appendChild(listItem);
    });
    wrapper.appendChild(list);
  }

  container.appendChild(wrapper);
}

function renderCardList(container, items, emptyText, itemClassName) {
  container.innerHTML = "";
  const values = sanitizeItems(items);

  if (!values.length) {
    container.appendChild(createEmptyState(emptyText));
    return;
  }

  const list = document.createElement("ul");
  list.className = itemClassName === "action-card" ? "action-list" : "stack-list";
  values.forEach((item) => {
    const listItem = document.createElement("li");
    listItem.className = itemClassName;
    listItem.textContent = item;
    list.appendChild(listItem);
  });
  container.appendChild(list);
}

function renderMetaChips(container, items) {
  container.innerHTML = "";
  items
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .forEach((item) => {
      const chip = document.createElement("span");
      chip.className = "meta-chip";
      chip.textContent = item;
      container.appendChild(chip);
    });
}

function createEmptyState(message) {
  const block = document.createElement("div");
  block.className = "state-card empty-state";
  block.dataset.tone = "idle";

  const label = document.createElement("p");
  label.className = "state-label";
  label.textContent = "目前為空";

  const copy = document.createElement("p");
  copy.className = "state-copy";
  copy.textContent = message;

  block.append(label, copy);
  return block;
}

function sanitizeItems(items) {
  return Array.isArray(items)
    ? items
        .map((item) => (typeof item === "string" ? item.trim() : String(item?.text || "").trim()))
        .filter(Boolean)
    : [];
}

function persistSettings() {
  const promptPreset = normalizePromptPreset(promptPresetSelect.value);
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      apiKey: apiKeyInput.value.trim(),
      model: modelSelect.value,
      title: manualTitleInput.value,
      text: manualTextInput.value,
      promptPreset
    })
  );
}

function updateOnlineState() {
  const offline = !navigator.onLine;
  offlineHint.hidden = !offline;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch {
    setStatus("PWA 快取初始化失敗，但不影響一般使用。", {
      tone: "warning",
      label: "快取提醒"
    });
  }
}

function setBusy(isBusy, message = "") {
  summarizeTextButton.disabled = isBusy;
  clearButton.disabled = isBusy;
  apiKeyInput.disabled = isBusy;
  modelSelect.disabled = isBusy;
  promptPresetSelect.disabled = isBusy;
  manualTitleInput.disabled = isBusy;
  manualTextInput.disabled = isBusy;
  if (message) {
    setStatus(message, {
      tone: isBusy ? "loading" : "idle",
      label: isBusy ? "整理進度" : "目前狀態"
    });
  }
}

function setStatus(message, { tone = "idle", label = "目前狀態" } = {}) {
  appState.status = { tone, label, message };
  renderStatus();
}

function renderStatus() {
  const current = appState.status;
  statusPill.dataset.tone = current.tone;
  statusPill.textContent = STATUS_PILL_TEXT[current.tone] || STATUS_PILL_TEXT.idle;
  statusBanner.dataset.tone = current.tone;
  statusLabel.textContent = current.label;
  statusText.textContent = current.message;
}

function setResultState(message, { tone = "idle", label = "結果狀態" } = {}) {
  appState.resultState = { tone, label, message };
  renderResultState();
}

function renderResultState() {
  const current = appState.resultState;
  resultStateCard.dataset.tone = current.tone;
  resultStateLabel.textContent = current.label;
  resultStateText.textContent = current.message;
}

function parseJson(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function resolvePromptPreset(promptPreset) {
  return PROMPT_PRESETS[promptPreset] || PROMPT_PRESETS[DEFAULT_PROMPT_PRESET];
}

function normalizePromptPreset(promptPreset) {
  return PROMPT_PRESETS[promptPreset] ? promptPreset : DEFAULT_PROMPT_PRESET;
}

function getPromptPresetMeta(promptPreset) {
  const normalizedPromptPreset = normalizePromptPreset(promptPreset);
  const preset = resolvePromptPreset(normalizedPromptPreset);

  return {
    promptPreset: normalizedPromptPreset,
    promptPresetLabel: preset.label
  };
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString("zh-TW");
  } catch {
    return iso;
  }
}

async function safeReadText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
