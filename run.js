(() => {

    "use strict";

    // ==========================
    // Zeta Memory v0.2.0
    // ==========================

    if (window.__ZETA_MEMORY_RUNNING__) {
        console.log("🧠 Zeta Memory already running.");
        return;
    }

    window.__ZETA_MEMORY_RUNNING__ = true;

    const VERSION = "0.2.0";
    const PROFILE_KEY = "zeta-memory-profile";
    const roomId = location.pathname.split("/").pop();
    const STORAGE_KEY = `zeta-memory-${roomId}`;
    const MEMORY_KEY = `${STORAGE_KEY}-memory`;
    const MEMORY_LENGTH_KEY = `${STORAGE_KEY}-memory-length`; // 하위 호환용(표시만)
    const MEMORY_INDEX_KEY = `${STORAGE_KEY}-memory-index`;   // 마지막 Memory 생성 시점의 메시지 개수

    // ---- 튜닝 가능한 값 ----
    const MEMORY_UPDATE_DELTA_CHARS = 5000; // 이 정도 새 대화가 쌓여야 재생성
    const MEMORY_DEBOUNCE_MS = 5000;        // 마지막 변화 후 조용해야 하는 시간

    let updatingMemory = false;
    let memoryDebounceTimer = null;

    console.log(`🧠 Zeta Memory v${VERSION}`);

    //------------------------------------------
    // UI
    //------------------------------------------

    const panel = document.createElement("div");
    panel.id = "zeta-memory-panel";

    Object.assign(panel.style, {
        position: "fixed",
        right: "16px",
        bottom: "80px",
        background: "#1f1f1f",
        color: "#fff",
        padding: "12px",
        borderRadius: "12px",
        fontSize: "13px",
        lineHeight: "1.5",
        fontFamily: "sans-serif",
        zIndex: 999999,
        boxShadow: "0 4px 15px rgba(0,0,0,.4)"
    });

    panel.innerHTML = `
<div style="font-weight:bold;font-size:15px;">🧠 Zeta Memory</div>
<div>v${VERSION}</div>
<hr style="margin:8px 0;border-color:#333;">
<div>Room</div>
<div id="zm-room">${roomId}</div>

<div style="margin-top:8px;">Messages</div>
<div id="zm-count">0</div>

<div style="margin-top:8px;">Saved</div>
<div id="zm-saved">0</div>

<div style="margin-top:8px;">Status</div>
<div id="zm-status">Idle</div>
`;

    document.body.appendChild(panel);

    //------------------------------------------
    // Utils
    //------------------------------------------

    function setStatus(text) {
        const el = document.getElementById("zm-status");
        if (el) el.textContent = text;
    }

    function setCount(n) {
        const el = document.getElementById("zm-count");
        if (el) el.textContent = n;
    }

    function setSaved(n) {
        const el = document.getElementById("zm-saved");
        if (el) el.textContent = n;
    }

    //------------------------------------------
    // Read Messages
    //------------------------------------------

    function getMessages() {

        const result = [];

        document
            .querySelectorAll(".bg-bubble-user, .bg-gray-sub1")
            .forEach(bubble => {

                const role = bubble.classList.contains("bg-bubble-user")
                    ? "user"
                    : "assistant";

                const chat = bubble.querySelector(".chat");

                if (!chat) return;

                const text = chat.innerText.trim();

                if (!text) return;

                result.push({ role, text });

            });

        setCount(result.length);

        return result;
    }

    //------------------------------------------
    // Save
    //------------------------------------------

    function saveHistory(messages) {

        const list = messages || getMessages();

        const data = {
            roomId,
            updatedAt: Date.now(),
            messages: list
        };

        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

        setSaved(list.length);

        console.log("✅ Saved", list.length);

        return list;
    }

    //------------------------------------------
    // Profile
    //------------------------------------------

    function getProfile() {

        const raw = localStorage.getItem(PROFILE_KEY);

        if (!raw) return null;

        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    function saveProfile(profile) {
        localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    }

    //------------------------------------------
    // LLM Call
    //------------------------------------------

    async function callOpenAI(prompt) {

        const profile = getProfile();

        if (!profile) {
            alert("프로필이 없습니다.");
            return;
        }

        const url =
            profile.provider === "cerebras"
                ? "https://api.cerebras.ai/v1/chat/completions"
                : "https://api.openai.com/v1/chat/completions";

        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${profile.apiKey}`
            },
            body: JSON.stringify({
                model: profile.model,
                messages: [
                    { role: "user", content: prompt }
                ]
            })
        });

        if (!res.ok) {
            const errText = await res.text().catch(() => "");
            throw new Error(`API 오류 ${res.status}: ${errText}`);
        }

        const data = await res.json();

        console.log(data);

        return data.choices[0].message.content;
    }

    //------------------------------------------
    // Memory helpers
    //------------------------------------------

    function getMemory() {
        return localStorage.getItem(MEMORY_KEY) || "";
    }

    function getMemoryIndex() {
        return Number(localStorage.getItem(MEMORY_INDEX_KEY) || 0);
    }

    function buildConversation(messages) {
        return messages
            .map(m => `${m.role.toUpperCase()}\n${m.text}`)
            .join("\n\n");
    }

    // 증분(incremental) 업데이트: 이전 Memory + 그 이후 새 대화만 LLM에 전달
    async function updateMemory() {

        if (updatingMemory) return;

        updatingMemory = true;
        setStatus("Memory 생성 중...");

        try {

            const history = getMessages();
            const lastIndex = getMemoryIndex();
            const deltaMessages = history.slice(lastIndex);

            if (deltaMessages.length === 0) {
                setStatus("갱신할 새 대화 없음");
                return getMemory();
            }

            const previousMemory = getMemory();
            const deltaConversation = buildConversation(deltaMessages);

            const prompt = `
당신은 롤플레이/대화의 장기 기억(Memory)을 관리합니다.

아래에는 "이전 Memory"와 "그 이후 새로 추가된 대화"가 주어집니다.
이전 Memory를 기반으로 새 정보만 반영하여 Memory를 갱신하세요.

규칙
- 추측하지 마세요.
- 새 대화에서 명시적으로 바뀌지 않은 항목(장소, 관계, 설정 등)은 이전 Memory의 값을 그대로 유지하세요.
- 장소가 명시되지 않았다면 이전 장소를 유지하세요.
- 앞으로 일어날 일을 예측하지 마세요.
- 확정된 사실만 기록하세요.
- 장소는 현재 장소만 유지하세요.
- 관계 변화는 유지하세요.
- 감정 변화는 유지하세요.
- 반복되는 사건은 제거하세요.
- 1200자 이내.
- 항목은
  현재 장소
  현재 관계
  현재 상황
  중요 설정
만 작성하세요.

[이전 Memory]
${previousMemory || "(없음, 최초 생성)"}

[새로 추가된 대화]
${deltaConversation}
`;

            const memory = await callOpenAI(prompt);

            localStorage.setItem(MEMORY_KEY, memory);
            localStorage.setItem(MEMORY_INDEX_KEY, history.length);
            localStorage.setItem(
                MEMORY_LENGTH_KEY,
                buildConversation(history).length
            );

            setStatus("Memory 갱신 완료");

            return memory;

        } catch (err) {

            console.error("❌ Memory 갱신 실패", err);
            setStatus("Memory 갱신 실패 (콘솔 확인)");

        } finally {
            updatingMemory = false;
        }
    }

    function maybeUpdateMemory() {

        const history = getMessages();
        const lastIndex = getMemoryIndex();
        const deltaMessages = history.slice(lastIndex);
        const deltaChars = buildConversation(deltaMessages).length;

        if (deltaChars >= MEMORY_UPDATE_DELTA_CHARS) {
            updateMemory();
        } else {
            setStatus("대기 중 (변화량 부족)");
        }
    }

    //------------------------------------------
    // Change detection (스크롤로 인한 과거 메시지 로딩과
    // 실제 새 메시지를 구분한다)
    //------------------------------------------

    let lastSignature = null; // { count, role, len, head }

    function getSignature(messages) {

        if (messages.length === 0) {
            return { count: 0, role: "", len: 0, head: "" };
        }

        const last = messages[messages.length - 1];

        return {
            count: messages.length,
            role: last.role,
            len: last.text.length,
            head: last.text.slice(0, 50)
        };
    }

    function sameSignature(a, b) {
        return (
            a.count === b.count &&
            a.role === b.role &&
            a.len === b.len &&
            a.head === b.head
        );
    }

    // 과거 메시지가 스크롤로 새로 DOM에 붙는 경우:
    // 메시지 개수는 바뀌지만 "마지막" 메시지는 그대로다.
    // 반대로 실제 새 메시지가 오면 마지막 메시지 자체가 바뀐다.
    function isRealNewMessage(current, previous) {
        if (!previous) return current.count > 0; // 최초 로드
        if (current.count === previous.count) return false;
        // 마지막 메시지가 동일하면(=앞쪽에 과거 메시지가 붙은 것) 새 메시지 아님
        const sameTail =
            current.role === previous.role &&
            current.len === previous.len &&
            current.head === previous.head;
        return !sameTail;
    }

    //------------------------------------------
    // Auto Save
    //------------------------------------------

    function autoSave() {

        const messages = getMessages();
        const signature = getSignature(messages);

        if (lastSignature && sameSignature(signature, lastSignature)) {
            return; // 아무 변화 없음
        }

        const isNew = isRealNewMessage(signature, lastSignature);

        lastSignature = signature;

        // history는 변화가 있으면 항상 즉시 저장 (스크롤 로딩 포함, 저장 자체는 저렴함)
        saveHistory(messages);

        if (!isNew) {
            // 과거 메시지가 스크롤로 로드된 것으로 판단 → Memory 타이머는 건드리지 않음
            setStatus("과거 메시지 로드 감지 (Memory 대기 유지)");
            return;
        }

        setStatus("새 메시지 감지, 대기 중...");

        // 5초 디바운스: 마지막 변화 후 5초간 조용하면 Memory 갱신 여부 판단
        clearTimeout(memoryDebounceTimer);
        memoryDebounceTimer = setTimeout(() => {
            maybeUpdateMemory();
        }, MEMORY_DEBOUNCE_MS);
    }

    //------------------------------------------
    // Observe
    //------------------------------------------

    const observer = new MutationObserver(() => {

        clearTimeout(window.__zetaMemoryTimer__);

        window.__zetaMemoryTimer__ = setTimeout(() => {
            autoSave();
        }, 300);

    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });

    //------------------------------------------
    // Context prefix (최종 목표: 요청 앞에 Memory + 사용자 입력 자동 첨부)
    //------------------------------------------

    const AUTO_INJECT_MEMORY = true; // 문제 생기면 false로 끄면 원상복구됨
    const STREAM_URL_RE = /\/v1\/rooms\/[^/]+\/messages\/stream(?:\?|$)/;
    const MEMORY_TAG = "[장기 기억]"; // 이미 주입된 요청 재시도 시 중복 방지용 마커

    function buildContextPrefix(userInput) {

        const memory = getMemory();

        if (!memory) return userInput;

        // 이미 한 번 주입된 텍스트라면(재시도 등) 다시 감싸지 않음
        if (userInput.startsWith(MEMORY_TAG)) return userInput;

        return `${MEMORY_TAG}\n${memory}\n\n[사용자 입력]\n${userInput}`;
    }

    // Zeta 메시지 전송(stream) 요청을 가로채서 payload.text 앞에
    // Memory를 자동으로 붙인다.
    //
    // 주의: 이 방식은 실제로 서버에 저장되는 메시지 내용 자체를 바꾼다.
    // Zeta가 채팅 히스토리를 새로고침 시 서버 데이터로 다시 그리는 방식이라면
    // 내 말풍선에 "[장기 기억] ... [사용자 입력] ..." 형태가 그대로 보일 수 있다.
    // 문제가 보이면 AUTO_INJECT_MEMORY를 false로 바꿔서 끄고 알려달라.
    if (AUTO_INJECT_MEMORY) {

        const originalFetch = window.fetch;

        window.fetch = async function (input, init) {

            try {

                const url =
                    typeof input === "string"
                        ? input
                        : (input && input.url) || "";

                const method = (
                    (init && init.method) ||
                    (typeof input !== "string" && input && input.method) ||
                    "GET"
                ).toUpperCase();

                if (method === "POST" && STREAM_URL_RE.test(url) && init && init.body) {

                    const bodyObj = JSON.parse(init.body);

                    if (bodyObj && bodyObj.type === "TEXT" && typeof bodyObj.text === "string") {

                        bodyObj.text = buildContextPrefix(bodyObj.text);

                        init = Object.assign({}, init, {
                            body: JSON.stringify(bodyObj)
                        });

                        console.log("🧠 Memory 주입됨:", bodyObj.text.slice(0, 80) + "...");
                    }
                }

            } catch (err) {
                console.error("❌ Memory 주입 실패, 원본 요청 그대로 전송", err);
            }

            return originalFetch.call(this, input, init);
        };
    }

    //------------------------------------------
    // First Save
    //------------------------------------------

    autoSave();
    setupProfile();

    function setupProfile() {

        if (getProfile()) return;

        const profileName = prompt("프로필 이름", "기본");
        if (profileName === null) return;

        const provider = prompt("Provider\n(cerebras)", "cerebras");
        if (provider === null) return;

        const model = prompt("모델", "gpt-oss-120b");
        if (model === null) return;

        const apiKey = prompt("API Key");
        if (apiKey === null) return;

        saveProfile({ profileName, provider, model, apiKey });

        console.log("✅ Profile Saved");
    }

    //------------------------------------------
    // Public API
    //------------------------------------------

    window.ZetaMemory = {
        version: VERSION,
        roomId,
        getMessages,
        saveHistory,
        autoSave,
        getProfile,
        callOpenAI,
        updateMemory,
        maybeUpdateMemory,
        getMemory,
        buildContextPrefix,
        observer
    };

    console.log("🧠 Zeta Memory Ready");

})();
