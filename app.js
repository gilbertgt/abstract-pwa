const apiKeyInput = document.getElementById("apiKeyInput");
const modelSelect = document.getElementById("modelSelect");
const promptPresetSelect = document.getElementById("promptPresetSelect");
const manualTitleInput = document.getElementById("manualTitleInput");
const manualTextInput = document.getElementById("manualTextInput");
const summarizeTextButton = document.getElementById("summarizeTextButton");
const clearButton = document.getElementById("clearButton");
const statusText = document.getElementById("statusText");
const offlineHint = document.getElementById("offlineHint");
const resultMeta = document.getElementById("resultMeta");
const resultTitle = document.getElementById("resultTitle");
const resultSummary = document.getElementById("resultSummary");
const keyPoints = document.getElementById("keyPoints");
const mainTakeaways = document.getElementById("mainTakeaways");
const keyFacts = document.getElementById("keyFacts");
const actionItems = document.getElementById("actionItems");

const STORAGE_KEY = "abstract-pwa-settings";
const RESULT_KEY = "abstract-pwa-last-result";
const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";
const DEFAULT_MODEL = "deepseek-chat";
const DEFAULT_PROMPT_PRESET = "bullet_points_first";
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

init();
summarizeTextButton.addEventListener("click", handleSummarizeText);
clearButton.addEventListener("click", handleClear);
promptPresetSelect.addEventListener("change", handlePromptPresetChange);
window.addEventListener("online", updateOnlineState);
window.addEventListener("offline", updateOnlineState);

async function init() {
  restoreSettings();
  restoreResult();
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
  setStatus("已載入上一次整理結果。");
}

async function handleSummarizeText() {
  const text = manualTextInput.value.trim();
  const apiKey = apiKeyInput.value.trim();

  if (!text) {
    setStatus("請先貼上要整理的文字內容。");
    manualTextInput.focus();
    return;
  }

  if (!apiKey) {
    setStatus("請先輸入 DeepSeek API Key。");
    apiKeyInput.focus();
    return;
  }

  if (!navigator.onLine) {
    setStatus("目前離線中，無法呼叫 DeepSeek。請先連上網路再試一次。");
    return;
  }

  const model = modelSelect.value || DEFAULT_MODEL;
  const title = manualTitleInput.value.trim();
  const promptPreset = normalizePromptPreset(promptPresetSelect.value);
  promptPresetSelect.value = promptPreset;
  setBusy(true, "正在進行深入條列整理...");

  try {
    const result = await summarizeManualText({ text, apiKey, model, title, promptPreset });
    persistSettings();
    localStorage.setItem(RESULT_KEY, JSON.stringify(result));
    renderResult(result);
    setStatus("整理完成。已更新為深入條列整理結果。", false);
  } catch (error) {
    setStatus(error.message || "整理失敗，請稍後再試。", true);
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
  setStatus("已清空輸入內容與暫存結果。");
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
  return {
    createdAt: new Date().toISOString(),
    sourceType: "manual",
    model,
    promptPreset: promptPresetMeta.promptPreset,
    promptPresetLabel: promptPresetMeta.promptPresetLabel,
    promptStyleLabel: promptPresetMeta.promptPresetLabel,
    pageMeta: payload.pageMeta,
    blocks: [],
    analysis
  };
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
  resultTitle.textContent = result.analysis.title || "手動整理結果";
  resultSummary.textContent = result.analysis.summary || "模型沒有回傳摘要。";
  renderList(keyPoints, result.analysis.key_points, "沒有關鍵重點。");
  renderList(mainTakeaways, result.analysis.main_takeaways, "沒有主要結論。");
  renderList(keyFacts, result.analysis.key_facts, "沒有關鍵事實。");
  renderList(actionItems, result.analysis.action_items, "沒有可行動項目。");
  const promptLabel = result.promptPresetLabel || result.promptStyleLabel || (result.promptPreset ? getPromptPresetMeta(result.promptPreset).promptPresetLabel : "未提供");
  resultMeta.textContent = `手動貼文字｜樣式：${promptLabel}｜深入整理模式｜${result.model}｜${formatTime(result.createdAt)}`;
}

function clearResult() {
  resultTitle.textContent = "尚無結果";
  resultSummary.textContent = "輸入文字並執行整理後，這裡會顯示繁體中文的深入條列整理結果。";
  resultMeta.textContent = "";
  renderList(keyPoints, [], "沒有關鍵重點。");
  renderList(mainTakeaways, [], "沒有主要結論。");
  renderList(keyFacts, [], "沒有關鍵事實。");
  renderList(actionItems, [], "沒有可行動項目。");
}

function renderList(container, items, emptyText) {
  container.innerHTML = "";
  const values = Array.isArray(items) ? items : [];

  const list = document.createElement("ul");
  values.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = typeof item === "string" ? item : String(item?.text || "").trim();
    if (li.textContent) {
      list.appendChild(li);
    }
  });

  if (!list.childElementCount) {
    const empty = document.createElement("p");
    empty.className = "empty-text";
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }

  container.appendChild(list);
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
    setStatus("PWA 快取初始化失敗，但不影響一般使用。", true);
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
    setStatus(message);
  }
}

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.style.color = isError ? "#ff9a85" : "";
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

