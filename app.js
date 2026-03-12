const apiKeyInput = document.getElementById("apiKeyInput");
const modelSelect = document.getElementById("modelSelect");
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

init();
summarizeTextButton.addEventListener("click", handleSummarizeText);
clearButton.addEventListener("click", handleClear);
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
  manualTitleInput.value = saved.title || "";
  manualTextInput.value = saved.text || "";
}

function restoreResult() {
  const savedResult = parseJson(localStorage.getItem(RESULT_KEY), null);
  if (savedResult) {
    renderResult(savedResult);
    setStatus("已載入上一次整理結果。");
  }
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
  setBusy(true, "正在整理貼上的文字...");

  try {
    const result = await summarizeManualText({ text, apiKey, model, title });
    persistSettings();
    localStorage.setItem(RESULT_KEY, JSON.stringify(result));
    renderResult(result);
    setStatus("整理完成。結果已保存在目前裝置瀏覽器。", false);
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

async function summarizeManualText({ text, apiKey, model, title }) {
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
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(payload) }
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
  return {
    createdAt: new Date().toISOString(),
    sourceType: "manual",
    model,
    pageMeta: payload.pageMeta,
    blocks: [],
    analysis
  };
}

function buildSystemPrompt() {
  return [
    "你是專門整理內容的繁體中文研究助理。",
    "所有輸出欄位、句子、標題、摘要、條列都必須使用自然且完整的繁體中文。",
    "禁止輸出簡體中文。若原文是英文或簡體中文，請將整理結果改寫成繁體中文。",
    "可保留必要的原文專有名詞，但主要敘述必須是繁體中文。",
    "摘要風格必須是重點筆記，不要寫成散文或空泛心得。",
    "這次來源是使用者手動貼上的文字。",
    "手動模式不需要頁面高亮，也不需要原文 block_ids 依據。",
    "key_points、main_takeaways、key_facts、action_items 若輸出物件，block_ids 固定為空陣列。",
    "important_block_ids 固定為空陣列。",
    "回覆必須是有效 JSON，不能包含 markdown 程式碼區塊或額外說明。"
  ].join(" ");
}

function buildUserPrompt(payload) {
  return [
    "請把下面的手動貼上文字整理成繁體中文重點筆記。",
    jsonSchemaText(),
    "輸出規則：",
    "1. 所有文字都必須是繁體中文。",
    "2. summary 要是短摘要，不要太空泛。",
    "3. key_points、main_takeaways、key_facts、action_items 都要寫成筆記式條列重點。",
    "4. 手動模式下所有 block_ids 都必須是空陣列。",
    "5. important_block_ids 必須是空陣列。",
    "6. 如果沒有可行動項目，action_items 請回傳空陣列。",
    `來源標題：${payload.pageMeta.title || ""}`,
    payload.blocks.map((block) => block.text).join("\n\n")
  ].join("\n");
}

function jsonSchemaText() {
  return [
    "請只輸出 JSON，欄位結構必須完全符合下列格式：",
    "{",
    '  "title": string,',
    '  "summary": string,',
    '  "key_points": Array<{ "text": string, "block_ids": string[] }>,',
    '  "main_takeaways": Array<{ "text": string, "block_ids": string[] }>,',
    '  "key_facts": Array<{ "text": string, "block_ids": string[] }>,',
    '  "action_items": Array<{ "text": string, "block_ids": string[] }>,',
    '  "important_block_ids": string[]',
    "}"
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
          const text = item.trim();
          return text ? { text, block_ids: [] } : null;
        }

        if (!item || typeof item !== "object") {
          return null;
        }

        const text = String(item.text || "").trim();
        if (!text) {
          return null;
        }

        return { text, block_ids: [] };
      })
      .filter(Boolean);
  };

  return {
    title: String(parsed?.title || "").trim() || "手動整理結果",
    summary: String(parsed?.summary || "").trim() || "模型沒有回傳摘要。",
    key_points: normalizeItems(parsed?.key_points),
    main_takeaways: normalizeItems(parsed?.main_takeaways),
    key_facts: normalizeItems(parsed?.key_facts),
    action_items: normalizeItems(parsed?.action_items),
    important_block_ids: []
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
  resultMeta.textContent = `手動貼文字｜文章模式｜${result.model}｜${formatTime(result.createdAt)}`;
}

function clearResult() {
  resultTitle.textContent = "尚無結果";
  resultSummary.textContent = "輸入文字並執行整理後，這裡會顯示繁體中文摘要與重點。";
  resultMeta.textContent = "";
  renderList(keyPoints, [], "沒有關鍵重點。");
  renderList(mainTakeaways, [], "沒有主要結論。");
  renderList(keyFacts, [], "沒有關鍵事實。");
  renderList(actionItems, [], "沒有可行動項目。");
}

function renderList(container, items, emptyText) {
  container.innerHTML = "";
  const values = Array.isArray(items) ? items : [];

  if (!values.length) {
    const empty = document.createElement("p");
    empty.className = "empty-text";
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }

  const list = document.createElement("ul");
  values.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = typeof item === "string" ? item : item.text || "";
    list.appendChild(li);
  });
  container.appendChild(list);
}

function persistSettings() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      apiKey: apiKeyInput.value.trim(),
      model: modelSelect.value,
      title: manualTitleInput.value,
      text: manualTextInput.value
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
  manualTitleInput.disabled = isBusy;
  manualTextInput.disabled = isBusy;
  if (message) {
    setStatus(message);
  }
}

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.style.color = isError ? "#9a2e16" : "";
}

function parseJson(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
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

