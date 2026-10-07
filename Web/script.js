/* =========================================================
   術語秒懂｜AI 專有名詞解釋器
   純 JavaScript，無框架、無後端。
   支援 Google Gemini（有免費額度）與 OpenAI 兩種 AI 服務。
   API Key 只存在 sessionStorage（關閉分頁即清除）。
   ========================================================= */
(() => {
  "use strict";

  const SYSTEM_PROMPT =
    "你是一位擅長把專業術語講得白話易懂的老師。請用繁體中文（台灣用語）解釋使用者提供的專有名詞，" +
    "對象是沒有相關背景的學生與一般大眾。要求：" +
    "1. 約 100 到 150 字；" +
    "2. 先用一句話說清楚它是什麼，再補充一個生活化的例子或比喻；" +
    "3. 不使用 Markdown、條列或標題，只輸出一到兩段純文字；" +
    "4. 若該名詞有多種領域的意思，以最常見的意思為主，並簡短提及其他用法。";

  const TIMEOUT_MS = 60000;
  const THEME_KEY = "terminology_theme";
  const PROVIDER_KEY = "terminology_provider";

  /* ---------- 文案 ---------- */
  const COPY = {
    keyUnset: "未設定 API Key",
    keySet: "API Key 已設定",
    btnIdle: "解釋",
    btnLoading: "解釋中...",
    errNoKey: "請先輸入並儲存 API Key。還沒有 Key？點「找不到 Key？」看教學。",
    errEmpty: "請輸入想查詢的名詞。",
    errInvalidKey: "API Key 無效，請確認後重新輸入。",
    errGeneric: "暫時無法取得解釋，請稍後再試。",
    errNetwork: "無法連線到 AI 服務。請檢查網路；學校或公司網路有時會封鎖，可改用手機熱點試試。",
    errTimeout: "AI 超過 60 秒沒有回應，通常是網路連不到 AI 服務（學校或公司網路可能會擋）。請改用手機熱點再試一次。",
    errRate: "查詢太頻繁，已超過每分鐘的免費次數上限，請等一分鐘再試。",
    errQuotaOpenAI: "OpenAI 帳戶額度不足，需要先到 Billing 頁面儲值。想免費使用，可以改選上方的「Gemini」。",
    errQuotaGemini: "今天的 Gemini 免費額度已用完，請明天再試，或改用其他 Google 帳號申請 Key。",
    errRegion: "這個 AI 服務在你目前的地區或帳戶無法使用，請改選另一個服務。",
    toastCopied: "已複製到剪貼簿",
    toastCopyFail: "複製失敗，請手動選取文字",
    toastSaved: "API Key 已儲存",
    toastCleared: "已清除 API Key",
  };

  /* =========================================================
     示意圖（SVG 線框，576 × 324）
     ========================================================= */
  const svgWrap = (inner) =>
    `<svg viewBox="0 0 576 324" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">
      <defs><linearGradient id="g-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6366F1"/><stop offset="1" stop-color="#22D3EE"/></linearGradient></defs>
      ${inner}
    </svg>`;

  const badge = (x, y, n) =>
    `<circle class="g-badge" cx="${x}" cy="${y}" r="14"/><text class="g-badge-text" x="${x}" y="${y + 4}" text-anchor="middle">${n}</text>`;

  const hlBox = (x, y, w, h) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="none" stroke="var(--color-accent)" stroke-width="2"/>`;

  const browser = (url, inner) => `
    <rect class="g-frame" x="24" y="20" width="528" height="284" rx="10"/>
    <line class="g-line" x1="24" y1="52" x2="552" y2="52"/>
    <circle class="g-bar" cx="44" cy="36" r="5"/><circle class="g-bar" cx="60" cy="36" r="5"/><circle class="g-bar" cx="76" cy="36" r="5"/>
    <rect class="g-bar" x="100" y="27" width="300" height="18" rx="9"/>
    <text class="g-text" x="114" y="40">${url}</text>
    ${inner}`;

  // 第 6 步：本站 Key 欄位 Saved 狀態
  const pasteBackSvg = (label, masked) => svgWrap(`
    <rect class="g-frame" x="88" y="48" width="400" height="228" rx="14"/>
    <text class="g-text" x="116" y="90" letter-spacing="1">${label}</text>
    <rect class="g-hl" x="116" y="102" width="344" height="44" rx="8"/>
    <text class="g-mono" x="132" y="129">${masked}</text>
    <circle class="g-ok" cx="390" cy="124" r="8"/>
    <path d="M386 124 l3 3 l5 -6" fill="none" stroke="#0B0E17" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="404" y="128" font-size="12" font-weight="600" fill="var(--color-success)" font-family="var(--font-sans)">已儲存</text>
    ${badge(478, 124, 6)}
    <g class="g-dim">
      <rect class="g-bar" x="116" y="160" width="300" height="8" rx="4"/>
      <line class="g-line" x1="116" y1="186" x2="460" y2="186"/>
      <rect class="g-bar" x="116" y="204" width="236" height="40" rx="8"/>
      <rect class="g-btn" x="364" y="204" width="96" height="40" rx="8"/>
    </g>`);

  /* =========================================================
     AI 服務設定（新增其他供應商只要照格式加一筆）
     ========================================================= */
  class ApiError extends Error {
    constructor(status, body) {
      super(`HTTP ${status}`);
      this.status = status;
      this.body = body;
    }
  }

  async function postJSON(url, headers, payload, signal) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload),
      signal,
    });
    let body = null;
    try { body = await res.json(); } catch { /* ignore */ }
    if (!res.ok) throw new ApiError(res.status, body);
    return body;
  }

  const PROVIDERS = {
    /* ---------- Google Gemini（免費額度） ---------- */
    gemini: {
      name: "Gemini",
      keyLabel: "GEMINI API KEY",
      placeholder: "AQ. 或 AIza 開頭",
      // Google 新版「授權金鑰」為 AQ. 開頭，舊版標準 Key 為 AIza 開頭，兩種都接受
      keyPattern: /^(AQ\.[0-9A-Za-z_\-.]{20,}|AIza[0-9A-Za-z_\-]{20,})$/,
      prefixHint: "「AQ.」或「AIza」",
      // 依序嘗試：先用回應最快的 Flash-Lite（官方「最新」別名），模型名稱不存在才換下一個
      models: ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-2.5-flash"],
      storageKey: "terminology_gemini_key",

      async explain(key, term, signal) {
        const request = (model, lowThinking) => {
          const generationConfig = { temperature: 0.4 };
          // Gemini Flash 預設會「思考」一段時間才回答；解釋名詞用不到，調到最低可大幅加快
          if (lowThinking) generationConfig.thinkingConfig = { thinkingLevel: "low" };
          return postJSON(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
            { "x-goog-api-key": key },
            {
              systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
              contents: [{ role: "user", parts: [{ text: `請解釋這個名詞：${term}` }] }],
              generationConfig,
            },
            signal
          );
        };

        let lastErr;
        for (const model of this.models) {
          try {
            let data;
            try {
              data = await request(model, true);
            } catch (err) {
              // 若此模型不支援思考強度設定（400），拿掉設定再送一次
              const unsupported = err instanceof ApiError && err.status === 400 &&
                /thinking/i.test(JSON.stringify(err.body || ""));
              if (!unsupported) throw err;
              data = await request(model, false);
            }
            const parts = data?.candidates?.[0]?.content?.parts || [];
            const text = parts.filter((p) => !p.thought && p.text).map((p) => p.text).join("").trim();
            if (!text) throw new ApiError(500, data);
            return { text, model: data.modelVersion || model };
          } catch (err) {
            lastErr = err;
            // 模型名稱不存在（404）才換下一個模型，其他錯誤直接回報
            if (!(err instanceof ApiError && err.status === 404)) throw err;
          }
        }
        throw lastErr;
      },

      classify(err) {
        const status = err.status;
        const reason = JSON.stringify(err.body || "");
        if (/API_KEY_INVALID|API key not valid|API_KEY/i.test(reason) || status === 401) return "invalidKey";
        if (status === 403 && /PERMISSION_DENIED|not been used|disabled/i.test(reason)) return "invalidKey";
        if (status === 400 && /location|region|FAILED_PRECONDITION/i.test(reason)) return "region";
        if (status === 429) return /per day|PerDay|daily/i.test(reason) ? "quota" : "rate";
        return "generic";
      },

      quotaMessage: COPY.errQuotaGemini,
      noteText: "介面以 Google AI Studio 官網為準",
      guide: [
        {
          title: "前往 Google AI Studio",
          text: "前往 aistudio.google.com，用你的 Google 帳號（Gmail）登入即可，不需要信用卡。",
          link: "https://aistudio.google.com",
          linkText: "開啟 Google AI Studio ↗",
          svg: svgWrap(browser("aistudio.google.com", `
            <g class="g-dim">
              <rect class="g-bar" x="48" y="74" width="110" height="12" rx="6"/>
              <rect class="g-bar" x="120" y="130" width="240" height="18" rx="9"/>
              <rect class="g-bar" x="150" y="160" width="180" height="10" rx="5"/>
              <rect class="g-bar" x="60" y="220" width="140" height="56" rx="8"/>
              <rect class="g-bar" x="218" y="220" width="140" height="56" rx="8"/>
              <rect class="g-bar" x="376" y="220" width="140" height="56" rx="8"/>
            </g>
            <rect class="g-btn" x="452" y="66" width="88" height="28" rx="6"/>
            <text class="g-btn-text" x="496" y="84" text-anchor="middle">Sign in</text>
            ${hlBox(448, 62, 96, 36)}
            ${badge(428, 80, 1)}`)),
        },
        {
          title: "同意使用條款",
          text: "第一次進入會跳出使用條款，勾選同意後按「Continue」就好；之前用過可以跳過這步。",
          link: "https://aistudio.google.com",
          linkText: "開啟 Google AI Studio ↗",
          svg: svgWrap(browser("aistudio.google.com", `
            <g class="g-dim"><rect class="g-bar" x="48" y="74" width="110" height="12" rx="6"/></g>
            <rect class="g-frame" x="138" y="76" width="300" height="208" rx="10"/>
            <text class="g-text-strong" x="162" y="108">Terms of Service</text>
            <g class="g-dim">
              <rect class="g-bar" x="162" y="124" width="250" height="8" rx="4"/>
              <rect class="g-bar" x="162" y="140" width="230" height="8" rx="4"/>
              <rect class="g-bar" x="162" y="156" width="240" height="8" rx="4"/>
            </g>
            <rect class="g-hl" x="162" y="182" width="16" height="16" rx="3"/>
            <path d="M165 190 l3 3 l6 -7" fill="none" stroke="var(--color-accent)" stroke-width="2" stroke-linecap="round"/>
            <text class="g-text" x="186" y="194">I agree</text>
            <rect class="g-btn" x="322" y="232" width="96" height="32" rx="6"/>
            <text class="g-btn-text" x="370" y="252" text-anchor="middle">Continue</text>
            ${hlBox(318, 228, 104, 40)}
            ${badge(456, 248, 2)}`)),
        },
        {
          title: "進入 API Keys 頁面",
          text: "點左下角或上方選單的「Get API key」，或直接點下方按鈕開啟頁面。",
          link: "https://aistudio.google.com/apikey",
          linkText: "開啟 API Keys 頁面 ↗",
          svg: svgWrap(browser("aistudio.google.com", `
            <rect class="g-frame" x="40" y="66" width="150" height="224" rx="8"/>
            <g class="g-dim">
              <rect class="g-bar" x="56" y="84" width="110" height="10" rx="5"/>
              <rect class="g-bar" x="56" y="110" width="90" height="10" rx="5"/>
              <rect class="g-bar" x="56" y="136" width="100" height="10" rx="5"/>
              <rect class="g-bar" x="56" y="162" width="80" height="10" rx="5"/>
              <rect class="g-bar" x="214" y="84" width="200" height="16" rx="8"/>
              <rect class="g-bar" x="214" y="120" width="320" height="10" rx="5"/>
              <rect class="g-bar" x="214" y="156" width="320" height="110" rx="8"/>
            </g>
            <rect class="g-hl" x="50" y="240" width="130" height="32" rx="6"/>
            <text class="g-hl-text" x="64" y="261">Get API key</text>
            ${badge(204, 256, 3)}`)),
        },
        {
          title: "建立新金鑰",
          text: "按「Create API key」。如果要你選專案，選預設的專案或按「Create project」建立一個即可。",
          link: "https://aistudio.google.com/apikey",
          linkText: "開啟 API Keys 頁面 ↗",
          svg: svgWrap(browser("aistudio.google.com/apikey", `
            <g class="g-dim">
              <rect class="g-bar" x="48" y="74" width="120" height="14" rx="7"/>
              <rect class="g-bar" x="48" y="104" width="480" height="40" rx="6"/>
            </g>
            <rect class="g-btn" x="412" y="66" width="128" height="28" rx="6"/>
            <text class="g-btn-text" x="476" y="84" text-anchor="middle">Create API key</text>
            ${hlBox(408, 62, 136, 36)}
            ${badge(390, 80, 4)}
            <rect class="g-frame" x="150" y="160" width="276" height="128" rx="10"/>
            <text class="g-text-strong" x="170" y="186">Create API key</text>
            <text class="g-text" x="170" y="210">Project</text>
            <rect class="g-hl" x="170" y="218" width="236" height="30" rx="6"/>
            <text class="g-mono" x="182" y="238">Default Project ▾</text>
            <g class="g-dim"><rect class="g-btn" x="330" y="256" width="76" height="22" rx="6"/></g>`)),
        },
        {
          title: "複製金鑰",
          text: "畫面會出現一串 Key，按旁邊的複製按鈕。新申請的 Key 通常以「AQ.」開頭，較早申請的以「AIza」開頭，兩種都可以用。請勿分享給他人或貼在公開地方。",
          link: "https://aistudio.google.com/apikey",
          linkText: "開啟 API Keys 頁面 ↗",
          svg: svgWrap(browser("aistudio.google.com/apikey", `
            <g class="g-dim">
              <rect class="g-bar" x="48" y="74" width="120" height="14" rx="7"/>
              <rect class="g-bar" x="48" y="104" width="480" height="40" rx="6"/>
            </g>
            <rect class="g-frame" x="108" y="100" width="360" height="176" rx="10"/>
            <text class="g-text-strong" x="132" y="130">API key generated</text>
            <path class="g-warn" d="M140 152 l9 16 h-18 z"/>
            <text x="140" y="166" text-anchor="middle" font-size="10" font-weight="700" fill="#0B0E17">!</text>
            <g class="g-dim"><rect class="g-bar" x="158" y="152" width="250" height="10" rx="5"/></g>
            <rect class="g-bar" x="132" y="186" width="232" height="34" rx="6"/>
            <text class="g-mono" x="144" y="208">AQ.Ab8R••••••••••••</text>
            <rect class="g-hl" x="374" y="186" width="70" height="34" rx="6"/>
            <text class="g-hl-text" x="409" y="208" text-anchor="middle">Copy</text>
            ${badge(486, 203, 5)}`)),
        },
        {
          title: "貼回本站",
          text: "貼到上方的 API Key 欄位並按「儲存」，就能開始查詢。免費額度有每分鐘與每日次數上限，查太快時稍等一下即可。",
          link: "https://aistudio.google.com/apikey",
          linkText: "開啟 API Keys 頁面 ↗",
          svg: pasteBackSvg("GEMINI API KEY", "AQ.Ab8R••••••••••••"),
        },
      ],
    },

    /* ---------- OpenAI（需儲值） ---------- */
    openai: {
      name: "OpenAI",
      keyLabel: "OPENAI API KEY",
      placeholder: "sk-...",
      keyPattern: /^sk-[A-Za-z0-9_\-]{10,}$/,
      prefixHint: "「sk-」",
      models: ["gpt-4o-mini"],
      storageKey: "terminology_openai_key",

      async explain(key, term, signal) {
        const model = this.models[0];
        const data = await postJSON(
          "https://api.openai.com/v1/chat/completions",
          { Authorization: `Bearer ${key}` },
          {
            model,
            temperature: 0.4,
            max_tokens: 400,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: `請解釋這個名詞：${term}` },
            ],
          },
          signal
        );
        const text = data?.choices?.[0]?.message?.content?.trim();
        if (!text) throw new ApiError(500, data);
        return { text, model: data.model || model };
      },

      classify(err) {
        const code = err.body?.error?.code || err.body?.error?.type || "";
        if (err.status === 401) return "invalidKey";
        if (err.status === 403) return "region";
        if (err.status === 429) return code === "insufficient_quota" ? "quota" : "rate";
        return "generic";
      },

      quotaMessage: COPY.errQuotaOpenAI,
      noteText: "介面以 OpenAI 官網為準",
      guide: [
        {
          title: "前往 OpenAI 開發者平台",
          text: "前往 platform.openai.com 登入或註冊。注意：這和 ChatGPT 訂閱是分開的，ChatGPT Plus 不含 API 額度。",
          link: "https://platform.openai.com",
          svg: svgWrap(browser("platform.openai.com", `
            <g class="g-dim">
              <rect class="g-bar" x="48" y="74" width="90" height="12" rx="6"/>
              <rect class="g-bar" x="120" y="130" width="240" height="18" rx="9"/>
              <rect class="g-bar" x="150" y="160" width="180" height="10" rx="5"/>
              <rect class="g-bar" x="60" y="230" width="140" height="50" rx="8"/>
              <rect class="g-bar" x="218" y="230" width="140" height="50" rx="8"/>
              <rect class="g-bar" x="376" y="230" width="140" height="50" rx="8"/>
            </g>
            <rect class="g-hl" x="418" y="66" width="56" height="28" rx="6"/>
            <text class="g-hl-text" x="446" y="84" text-anchor="middle">Log in</text>
            <rect class="g-btn" x="480" y="66" width="60" height="28" rx="6"/>
            <text class="g-btn-text" x="510" y="84" text-anchor="middle">Sign up</text>
            ${hlBox(414, 62, 130, 36)}
            ${badge(396, 80, 1)}`)),
        },
        {
          title: "建立組織與專案",
          text: "第一次使用會要求建立組織與專案，取個名字即可；已經建過可以跳過。",
          link: "https://platform.openai.com",
          svg: svgWrap(browser("platform.openai.com/onboarding", `
            <g class="g-dim"><rect class="g-bar" x="48" y="74" width="90" height="12" rx="6"/></g>
            <rect class="g-frame" x="148" y="80" width="280" height="200" rx="10"/>
            <text class="g-text-strong" x="172" y="112">Create organization</text>
            <g class="g-dim"><rect class="g-bar" x="172" y="124" width="200" height="8" rx="4"/></g>
            <text class="g-text" x="172" y="160">Organization name</text>
            <rect class="g-hl" x="172" y="168" width="232" height="32" rx="6"/>
            <text class="g-mono" x="184" y="189">My Study</text>
            <rect class="g-btn" x="304" y="224" width="100" height="32" rx="6"/>
            <text class="g-btn-text" x="354" y="244" text-anchor="middle">Create</text>
            ${hlBox(300, 220, 108, 40)}
            ${badge(446, 184, 2)}`)),
        },
        {
          title: "進入 API keys 頁面",
          text: "從選單進入 API keys，或直接點下方按鈕開啟頁面。",
          link: "https://platform.openai.com/api-keys",
          svg: svgWrap(browser("platform.openai.com/settings", `
            <rect class="g-frame" x="40" y="66" width="150" height="224" rx="8"/>
            <g class="g-dim">
              <rect class="g-bar" x="56" y="84" width="110" height="10" rx="5"/>
              <rect class="g-bar" x="56" y="110" width="90" height="10" rx="5"/>
              <rect class="g-bar" x="56" y="136" width="100" height="10" rx="5"/>
              <rect class="g-bar" x="56" y="212" width="96" height="10" rx="5"/>
              <rect class="g-bar" x="56" y="238" width="80" height="10" rx="5"/>
              <rect class="g-bar" x="214" y="84" width="200" height="16" rx="8"/>
              <rect class="g-bar" x="214" y="120" width="320" height="10" rx="5"/>
              <rect class="g-bar" x="214" y="140" width="280" height="10" rx="5"/>
              <rect class="g-bar" x="214" y="176" width="320" height="90" rx="8"/>
            </g>
            <rect class="g-hl" x="50" y="164" width="130" height="32" rx="6"/>
            <text class="g-hl-text" x="64" y="185">API keys</text>
            ${badge(204, 180, 3)}`)),
        },
        {
          title: "建立新金鑰",
          text: "點「Create new secret key」，取個好認的名稱，例如「術語秒懂」。",
          link: "https://platform.openai.com/api-keys",
          svg: svgWrap(browser("platform.openai.com/api-keys", `
            <g class="g-dim">
              <rect class="g-bar" x="48" y="74" width="120" height="14" rx="7"/>
              <rect class="g-bar" x="48" y="104" width="480" height="40" rx="6"/>
              <rect class="g-bar" x="48" y="150" width="480" height="40" rx="6"/>
            </g>
            <rect class="g-btn" x="388" y="66" width="152" height="28" rx="6"/>
            <text class="g-btn-text" x="464" y="84" text-anchor="middle">+ Create new secret key</text>
            ${hlBox(384, 62, 160, 36)}
            ${badge(366, 80, 4)}
            <rect class="g-frame" x="150" y="168" width="276" height="120" rx="10"/>
            <text class="g-text-strong" x="170" y="194">Create new secret key</text>
            <text class="g-text" x="170" y="218">Name</text>
            <rect class="g-hl" x="170" y="226" width="236" height="30" rx="6"/>
            <text class="g-mono" x="182" y="246">術語秒懂</text>`)),
        },
        {
          title: "馬上複製金鑰",
          text: "關掉視窗後就看不到完整的 Key，請立刻複製。請勿分享給他人或貼在公開地方。",
          link: "https://platform.openai.com/api-keys",
          svg: svgWrap(browser("platform.openai.com/api-keys", `
            <g class="g-dim">
              <rect class="g-bar" x="48" y="74" width="120" height="14" rx="7"/>
              <rect class="g-bar" x="48" y="104" width="480" height="40" rx="6"/>
            </g>
            <rect class="g-frame" x="108" y="100" width="360" height="176" rx="10"/>
            <text class="g-text-strong" x="132" y="130">Save your key</text>
            <path class="g-warn" d="M140 152 l9 16 h-18 z"/>
            <text x="140" y="166" text-anchor="middle" font-size="10" font-weight="700" fill="#0B0E17">!</text>
            <g class="g-dim"><rect class="g-bar" x="158" y="152" width="250" height="10" rx="5"/></g>
            <rect class="g-bar" x="132" y="186" width="232" height="34" rx="6"/>
            <text class="g-mono" x="144" y="208">sk-proj-••••••••••••</text>
            <rect class="g-hl" x="374" y="186" width="70" height="34" rx="6"/>
            <text class="g-hl-text" x="409" y="208" text-anchor="middle">Copy</text>
            ${badge(486, 203, 5)}`)),
        },
        {
          title: "貼回本站",
          text: "貼到 API Key 欄位並按「儲存」。若查詢失敗顯示額度不足，需到 OpenAI 的 Billing 頁面儲值。",
          link: "https://platform.openai.com/settings/organization/billing",
          linkText: "開啟 Billing 頁面 ↗",
          svg: pasteBackSvg("OPENAI API KEY", "sk-proj-••••••••••••"),
        },
      ],
    },
  };

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const el = {
    root: document.documentElement,
    header: $("header"),
    keyStatus: $("keyStatus"),
    keyStatusText: $("keyStatusText"),
    themeToggle: $("themeToggle"),
    providerBtns: document.querySelectorAll(".segmented__item"),
    keyLabel: $("keyLabel"),
    apiKey: $("apiKey"),
    keyWrap: $("keyInputWrap"),
    toggleKey: $("toggleKey"),
    saveKey: $("saveKey"),
    keyError: $("keyError"),
    openGuide: $("openGuide"),
    form: $("termForm"),
    termInput: $("termInput"),
    termError: $("termError"),
    explainBtn: $("explainBtn"),
    pills: document.querySelectorAll(".pill"),
    resultCard: $("resultCard"),
    resultTerm: $("resultTerm"),
    resultBody: $("resultBody"),
    resultModel: $("resultModel"),
    resultTime: $("resultTime"),
    errorText: $("errorText"),
    slowHint: $("slowHint"),
    copyBtn: $("copyBtn"),
    toast: $("toast"),
    toastText: $("toastText"),
    modal: $("guideModal"),
    guideCounter: $("guideCounter"),
    guideTitle: $("guideTitle"),
    guideProgress: $("guideProgress"),
    guideBody: $("guideBody"),
    guideSlide: $("guideSlide"),
    guideFigure: $("guideFigure"),
    guideNote: $("guideNote"),
    guideText: $("guideText"),
    guideLink: $("guideLink"),
    guidePrev: $("guidePrev"),
    guideNext: $("guideNext"),
  };

  /* =========================================================
     sessionStorage 存取（包 try/catch，隱私模式也不會壞）
     ========================================================= */
  const store = {
    get(key) {
      try { return sessionStorage.getItem(key) || ""; } catch { return ""; }
    },
    set(key, value) {
      try { sessionStorage.setItem(key, value); } catch { /* ignore */ }
    },
    remove(key) {
      try { sessionStorage.removeItem(key); } catch { /* ignore */ }
    },
  };

  const state = {
    provider: PROVIDERS[store.get(PROVIDER_KEY)] ? store.get(PROVIDER_KEY) : "gemini",
    savedKey: "",
    loading: false,
    guideStep: 0,
    lastFocus: null,
    toastTimer: null,
  };

  const P = () => PROVIDERS[state.provider];

  /* =========================================================
     主題切換（預設暗色）
     ========================================================= */
  function applyTheme(theme) {
    el.root.setAttribute("data-theme", theme);
    el.themeToggle.setAttribute("aria-label", theme === "dark" ? "切換為亮色模式" : "切換為暗色模式");
  }

  applyTheme(store.get(THEME_KEY) || "dark");

  el.themeToggle.addEventListener("click", () => {
    const next = el.root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
    store.set(THEME_KEY, next);
  });

  /* ---------- Header：捲動後加 blur 背景 ---------- */
  const onScroll = () => el.header.classList.toggle("is-scrolled", window.scrollY > 4);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* =========================================================
     AI 服務切換
     ========================================================= */
  function selectProvider(id) {
    state.provider = id;
    store.set(PROVIDER_KEY, id);
    const p = P();

    el.providerBtns.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.provider === id)));
    el.keyLabel.textContent = p.keyLabel;
    el.apiKey.placeholder = p.placeholder;

    state.savedKey = store.get(p.storageKey);
    el.apiKey.value = state.savedKey;
    showKeyError("");
    setKeyFieldState(state.savedKey ? "saved" : "default");
    renderKeyStatus();

    // 換服務後，舊的錯誤訊息不再適用
    if (el.resultCard.dataset.state === "error") setResult("empty");
  }

  el.providerBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!state.loading) selectProvider(btn.dataset.provider);
    });
    // 方向鍵切換（radiogroup 慣例）
    btn.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const other = [...el.providerBtns].find((b) => b !== btn);
        other.focus();
        other.click();
      }
    });
  });

  /* =========================================================
     API Key 欄位
     ========================================================= */
  function setKeyFieldState(s) {
    el.keyWrap.dataset.state = s; // default | saved | error
    el.apiKey.setAttribute("aria-invalid", s === "error" ? "true" : "false");
  }

  function showKeyError(msg) {
    if (msg) {
      el.keyError.textContent = msg;
      el.keyError.hidden = false;
      setKeyFieldState("error");
    } else {
      el.keyError.hidden = true;
      el.keyError.textContent = "";
    }
  }

  function renderKeyStatus() {
    const has = Boolean(state.savedKey);
    el.keyStatus.dataset.state = has ? "set" : "unset";
    el.keyStatusText.textContent = has ? `${P().name} ${COPY.keySet}` : COPY.keyUnset;
    updateButtonState();
  }

  function clearSavedKey() {
    state.savedKey = "";
    store.remove(P().storageKey);
    renderKeyStatus();
  }

  function saveKey() {
    const value = el.apiKey.value.trim();
    const p = P();

    if (!value) {
      if (state.savedKey) {
        clearSavedKey();
        showToast(COPY.toastCleared);
      }
      showKeyError(COPY.errNoKey);
      el.apiKey.focus();
      return;
    }

    if (!p.keyPattern.test(value)) {
      const hint = state.provider === "gemini" && value.startsWith("sk-")
        ? "這是 OpenAI 的 Key，請在上方改選「OpenAI」。"
        : state.provider === "openai" && /^(AIza|AQ\.)/.test(value)
          ? "這是 Gemini 的 Key，請在上方改選「Gemini」。"
          : `${COPY.errInvalidKey}（${p.name} 的 Key 以${p.prefixHint}開頭）`;
      showKeyError(hint);
      el.apiKey.focus();
      return;
    }

    state.savedKey = value;
    store.set(p.storageKey, value);
    showKeyError("");
    setKeyFieldState("saved");
    renderKeyStatus();
    showToast(COPY.toastSaved);
  }

  el.saveKey.addEventListener("click", saveKey);

  el.apiKey.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveKey();
    }
  });

  el.apiKey.addEventListener("input", () => {
    showKeyError("");
    const same = state.savedKey && el.apiKey.value.trim() === state.savedKey;
    setKeyFieldState(same ? "saved" : "default");
  });

  el.toggleKey.addEventListener("click", () => {
    const show = el.apiKey.type === "password";
    el.apiKey.type = show ? "text" : "password";
    el.toggleKey.setAttribute("aria-pressed", String(show));
    el.toggleKey.setAttribute("aria-label", show ? "隱藏 API Key" : "顯示 API Key");
  });

  /* =========================================================
     名詞輸入與送出
     ========================================================= */
  function canSubmit() {
    return Boolean(state.savedKey) && el.termInput.value.trim().length > 0 && !state.loading;
  }

  function updateButtonState() {
    el.explainBtn.disabled = !canSubmit();
  }

  function showTermError(msg) {
    el.termError.textContent = msg || "";
    el.termError.hidden = !msg;
    el.termInput.setAttribute("aria-invalid", msg ? "true" : "false");
  }

  el.termInput.addEventListener("input", () => {
    showTermError("");
    updateButtonState();
  });

  // 按鈕 Disabled 時 Enter 不會觸發 submit，這裡手動處理以顯示錯誤回饋
  el.termInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      trySubmit();
    }
  });

  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
    trySubmit();
  });

  el.pills.forEach((pill) => {
    pill.addEventListener("click", () => {
      if (state.loading) return;
      el.termInput.value = pill.dataset.term;
      showTermError("");
      updateButtonState();
      trySubmit();
    });
  });

  function trySubmit() {
    if (state.loading) return;
    const term = el.termInput.value.trim();

    if (!state.savedKey) {
      setResult("error", { message: COPY.errNoKey });
      showKeyError(COPY.errNoKey);
      return;
    }
    if (!term) {
      showTermError(COPY.errEmpty);
      el.termInput.focus();
      return;
    }
    explain(term);
  }

  /* =========================================================
     結果卡片狀態
     ========================================================= */
  function setResult(s, data = {}) {
    el.resultCard.dataset.state = s; // empty | loading | success | error
    el.resultCard.setAttribute("aria-busy", s === "loading" ? "true" : "false");

    if (s === "success") {
      el.resultTerm.textContent = data.term;
      el.resultBody.textContent = data.text;
      el.resultModel.textContent = data.model;
      el.resultTime.textContent = data.time;
    }
    if (s === "error") {
      el.errorText.textContent = data.message;
    }
  }

  function setLoading(on) {
    state.loading = on;
    el.explainBtn.classList.toggle("is-loading", on);
    el.explainBtn.querySelector(".btn-primary__text").textContent = on ? COPY.btnLoading : COPY.btnIdle;
    el.termInput.disabled = on;
    el.pills.forEach((p) => (p.disabled = on));
    el.providerBtns.forEach((b) => (b.disabled = on));
    updateButtonState();
  }

  function formatTime(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /* =========================================================
     呼叫 AI
     ========================================================= */
  function errorMessage(err, p) {
    if (err.name === "AbortError") return COPY.errTimeout;
    if (!(err instanceof ApiError)) return COPY.errNetwork; // fetch 本身失敗＝連不上
    switch (p.classify(err)) {
      case "invalidKey": return COPY.errInvalidKey;
      case "quota": return p.quotaMessage;
      case "rate": return COPY.errRate;
      case "region": return COPY.errRegion;
      default: return COPY.errGeneric;
    }
  }

  async function explain(term) {
    const p = P();
    showTermError("");
    setLoading(true);
    setResult("loading");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    // 超過 8 秒還沒回應，提示使用者仍在處理
    const slowTimer = setTimeout(() => (el.slowHint.hidden = false), 8000);

    try {
      const { text, model } = await p.explain(state.savedKey, term, controller.signal);
      setResult("success", { term, text, model, time: formatTime(new Date()) });
    } catch (err) {
      console.error("[術語秒懂]", p.name, err.status || "", err.body || err);
      const message = errorMessage(err, p);
      if (message === COPY.errInvalidKey) {
        // Key 無效：清除已存的 Key，讓使用者重新輸入
        clearSavedKey();
        showKeyError(COPY.errInvalidKey);
      }
      setResult("error", { message });
    } finally {
      clearTimeout(timer);
      clearTimeout(slowTimer);
      el.slowHint.hidden = true;
      setLoading(false);
    }
  }

  /* =========================================================
     複製解釋
     ========================================================= */
  el.copyBtn.addEventListener("click", async () => {
    const text = `${el.resultTerm.textContent}\n\n${el.resultBody.textContent}`;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        if (!ok) throw new Error("copy failed");
      }
      showToast(COPY.toastCopied);
    } catch {
      showToast(COPY.toastCopyFail, "error");
    }
  });

  /* =========================================================
     Toast
     ========================================================= */
  function showToast(message, type = "success") {
    clearTimeout(state.toastTimer);
    el.toastText.textContent = message;
    el.toast.dataset.type = type;
    el.toast.hidden = false;
    el.toast.style.animation = "none";
    void el.toast.offsetWidth;
    el.toast.style.animation = "";
    state.toastTimer = setTimeout(() => (el.toast.hidden = true), 2000);
  }

  /* =========================================================
     「找不到 Key？」教學彈窗（內容依目前選的 AI 服務）
     ========================================================= */
  function renderGuide(direction) {
    const steps = P().guide;
    const i = state.guideStep;
    const step = steps[i];
    const total = steps.length;
    const isLast = i === total - 1;

    el.guideCounter.textContent = `STEP ${i + 1} / ${total}`;
    el.guideTitle.textContent = step.title;
    el.guideFigure.innerHTML = step.svg;
    el.guideNote.textContent = P().noteText;
    el.guideText.textContent = step.text;
    el.guideLink.href = step.link;
    el.guideLink.textContent = step.linkText || "開啟 OpenAI 頁面 ↗";

    el.guideProgress.innerHTML = steps
      .map((_, idx) => `<span class="progress__seg${idx <= i ? " is-done" : ""}"></span>`)
      .join("");

    el.guidePrev.disabled = i === 0;
    el.guideNext.querySelector(".btn-primary__text").textContent = isLast ? "去貼上 Key" : "下一步";

    if (direction) {
      el.guideSlide.classList.remove("slide-next", "slide-prev");
      void el.guideSlide.offsetWidth;
      el.guideSlide.classList.add(direction === 1 ? "slide-next" : "slide-prev");
    }
    el.guideBody.scrollTop = 0;
  }

  function goStep(delta) {
    const next = state.guideStep + delta;
    if (next < 0 || next >= P().guide.length) return;
    state.guideStep = next;
    renderGuide(delta);
  }

  function openGuide() {
    state.lastFocus = document.activeElement;
    state.guideStep = 0;
    renderGuide();
    el.modal.hidden = false;
    el.modal.classList.remove("is-closing");
    document.body.classList.add("is-locked");
    el.modal.querySelector(".modal__panel").focus();
    document.addEventListener("keydown", onModalKey);
  }

  function closeGuide({ focusKey = false } = {}) {
    if (el.modal.hidden || el.modal.classList.contains("is-closing")) return;
    el.modal.classList.add("is-closing");
    document.removeEventListener("keydown", onModalKey);

    setTimeout(() => {
      el.modal.hidden = true;
      el.modal.classList.remove("is-closing");
      document.body.classList.remove("is-locked");
      if (focusKey) {
        el.apiKey.focus();
        el.apiKey.select();
      } else if (state.lastFocus) {
        state.lastFocus.focus();
      }
    }, 200);
  }

  function onModalKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeGuide();
    } else if (e.key === "ArrowRight") {
      goStep(1);
    } else if (e.key === "ArrowLeft") {
      goStep(-1);
    } else if (e.key === "Tab") {
      // 焦點鎖在彈窗內
      const list = [...el.modal.querySelectorAll('button:not([disabled]), a[href]')]
        .filter((n) => n.offsetParent !== null);
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  el.openGuide.addEventListener("click", openGuide);
  el.modal.querySelectorAll("[data-close]").forEach((n) => n.addEventListener("click", () => closeGuide()));
  el.guidePrev.addEventListener("click", () => goStep(-1));
  el.guideNext.addEventListener("click", () => {
    if (state.guideStep === P().guide.length - 1) {
      closeGuide({ focusKey: true });
    } else {
      goStep(1);
    }
  });

  // 手機左右滑動切換步驟
  let touchX = null;
  let touchY = null;
  el.guideBody.addEventListener("touchstart", (e) => {
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
  }, { passive: true });

  el.guideBody.addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      goStep(dx < 0 ? 1 : -1);
    }
    touchX = touchY = null;
  }, { passive: true });

  /* ---------- 初始化 ---------- */
  selectProvider(state.provider);
  setResult("empty");
})();
