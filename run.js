(() => {

    "use strict";

    // ==========================
    // Zeta User Note v1.0.0
    // - AI 요약 없음. 유저가 직접 쓴 노트를 저장해뒀다가
    //   전송 시 입력창엔 안 보이게 요청 body에만 몰래 끼워 넣는다.
    // ==========================

    if (window.__ZETA_USERNOTE_RUNNING__) {
        console.log("📝 Zeta UserNote already running.");
        return;
    }
    window.__ZETA_USERNOTE_RUNNING__ = true;

    const VERSION = "1.0.0";
    const NOTE_TAG = "[유저 노트]";
    const STREAM_URL_RE = /\/v1\/rooms\/[^/]+\/messages\/stream(?:\?|$)/;

    const ENABLED_KEY = "zeta-usernote-enabled"; // 전역: 삽입 on/off
    const POS_KEY = "zeta-usernote-pos";         // 전역: 버튼/패널 위치(드래그 결과)

    // ---- 방(room) 감지 ----
    // SPA라 새로고침 없이 방을 이동할 수 있으므로, roomId는 폴링으로 계속 갱신한다.
    function currentRoomId() {
        return location.pathname.split("/").pop();
    }

    let roomId = currentRoomId();
    let noteKey = `zeta-usernote-${roomId}`;

    function getNote() {
        return localStorage.getItem(noteKey) || "";
    }

    function saveNote(text) {
        localStorage.setItem(noteKey, text || "");
    }

    function isEnabled() {
        const v = localStorage.getItem(ENABLED_KEY);
        return v === null ? true : v === "1";
    }

    function setEnabled(v) {
        localStorage.setItem(ENABLED_KEY, v ? "1" : "0");
    }

    function getPos() {
        try {
            return JSON.parse(localStorage.getItem(POS_KEY)) || { left: 16, bottom: 80 };
        } catch {
            return { left: 16, bottom: 80 };
        }
    }

    function savePos(pos) {
        localStorage.setItem(POS_KEY, JSON.stringify(pos));
    }

    //------------------------------------------
    // UI - Shadow DOM으로 완전히 격리
    // (피드백 1: 웹제타에 테마를 씌우면 내 UI가 묻히는 문제 대응)
    // - 페이지 CSS가 셀렉터로 침범할 수 없음 (Shadow 경계)
    // - :host { all: initial } 로 상속 스타일(글꼴/색 등)도 차단
    // - z-index를 브라우저 허용 최댓값으로 고정
    //------------------------------------------

    const host = document.createElement("div");
    host.id = "zeta-usernote-host";
    document.documentElement.appendChild(host);
    const root = host.attachShadow({ mode: "open" });

    root.innerHTML = `
<style>
  :host {
    all: initial;
    position: fixed !important;
    top: 0; left: 0;
    z-index: 2147483647 !important;
  }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }

  #btn {
    position: fixed;
    width: 42px; height: 42px; border-radius: 50%;
    background: #ff5d8f; color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-size: 19px; cursor: pointer;
    box-shadow: 0 4px 16px rgba(0,0,0,.5);
    border: 2px solid #fff;
    touch-action: none;
    user-select: none;
  }
  #btn.dragging { opacity: 0.7; }

  #panel {
    position: fixed;
    width: 260px; max-height: 62vh; overflow-y: auto;
    background: #17171c; color: #fff;
    border: 1px solid #ff5d8f; border-radius: 12px;
    padding: 12px; font-size: 12px; line-height: 1.5;
    box-shadow: 0 6px 24px rgba(0,0,0,.6);
    display: none;
  }
  #panel.open { display: block; }

  textarea {
    width: 100%; height: 28vh; background: #0d0d10; color: #fff;
    border: 1px solid #444; border-radius: 8px; padding: 8px;
    font-size: 12px; resize: vertical;
  }
  .row { display: flex; gap: 6px; margin-top: 8px; align-items: center; }
  button {
    background: #333; color: #fff; border: none; border-radius: 8px;
    padding: 7px 8px; font-size: 11px; cursor: pointer; flex: 1;
  }
  button.primary { background: #ff5d8f; }
  label { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #ccc; }
  .title { font-weight: bold; font-size: 13px; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; }
  .room { color: #999; font-size: 10px; margin-bottom: 8px; word-break: break-all; }
  .count { color: #999; font-size: 10px; text-align: right; margin-top: 4px; }
  .saved-badge { color: #7CFC9C; font-size: 10px; opacity: 0; transition: opacity .3s; }
  .saved-badge.show { opacity: 1; }
</style>

<div id="btn">📝</div>
<div id="panel">
  <div class="title">
    <span>📝 User Note</span>
    <span style="font-weight:normal;font-size:10px;color:#999;">v${VERSION}</span>
  </div>
  <div class="room" id="room"></div>
  <textarea id="note" placeholder="예)
현재상황요약: ...
현재 장소: ...
중요 설정: ..."></textarea>
  <div class="count" id="count">0자</div>
  <div class="row">
    <label style="flex:1;"><input type="checkbox" id="enabled"> 전송 시 자동 삽입</label>
    <span class="saved-badge" id="saved">저장됨</span>
  </div>
  <div class="row">
    <button class="primary" id="save">저장</button>
    <button id="clear">비우기</button>
  </div>
</div>
`;

    const btnEl = root.getElementById("btn");
    const panelEl = root.getElementById("panel");
    const noteEl = root.getElementById("note");
    const roomEl = root.getElementById("room");
    const countEl = root.getElementById("count");
    const savedEl = root.getElementById("saved");
    const enabledEl = root.getElementById("enabled");

    function applyPos(pos) {
        btnEl.style.left = pos.left + "px";
        btnEl.style.bottom = pos.bottom + "px";
        panelEl.style.left = pos.left + "px";
        panelEl.style.bottom = (pos.bottom + 50) + "px";
    }

    applyPos(getPos());

    function refreshRoomUI() {
        roomEl.textContent = `Room: ${roomId.slice(0, 24)}`;
        noteEl.value = getNote();
        updateCount();
    }

    function updateCount() {
        countEl.textContent = `${noteEl.value.length.toLocaleString()}자`;
    }

    function flashSaved() {
        savedEl.classList.add("show");
        clearTimeout(flashSaved._t);
        flashSaved._t = setTimeout(() => savedEl.classList.remove("show"), 1200);
    }

    enabledEl.checked = isEnabled();
    refreshRoomUI();

    //------------------------------------------
    // 패널 토글 (드래그와 클릭 구분)
    //------------------------------------------

    let dragging = false;
    let moved = false;
    let startX = 0, startY = 0;
    let startPos = null;

    function pointFromEvent(e) {
        if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        return { x: e.clientX, y: e.clientY };
    }

    function onDragStart(e) {
        dragging = true;
        moved = false;
        const p = pointFromEvent(e);
        startX = p.x;
        startY = p.y;
        startPos = getPos();
        btnEl.classList.add("dragging");
    }

    function onDragMove(e) {
        if (!dragging) return;
        const p = pointFromEvent(e);
        const dx = p.x - startX;
        const dy = p.y - startY;

        if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
        if (!moved) return;

        // 화면 밖으로 나가지 않게 clamp
        const newLeft = Math.min(Math.max(startPos.left + dx, 4), window.innerWidth - 46);
        const newBottom = Math.min(Math.max(startPos.bottom - dy, 4), window.innerHeight - 46);

        applyPos({ left: newLeft, bottom: newBottom });
    }

    function onDragEnd() {
        if (!dragging) return;
        dragging = false;
        btnEl.classList.remove("dragging");

        if (moved) {
            savePos(getComputedPos());
        } else {
            setPanelOpen(!panelEl.classList.contains("open"));
        }
    }

    function getComputedPos() {
        return {
            left: parseFloat(btnEl.style.left) || 16,
            bottom: parseFloat(btnEl.style.bottom) || 80
        };
    }

    btnEl.addEventListener("mousedown", onDragStart);
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragEnd);

    btnEl.addEventListener("touchstart", onDragStart, { passive: true });
    window.addEventListener("touchmove", onDragMove, { passive: true });
    window.addEventListener("touchend", onDragEnd);

    function setPanelOpen(open) {
        panelEl.classList.toggle("open", open);
        if (open) refreshRoomUI();
    }

    //------------------------------------------
    // 노트 저장 / 비우기
    //------------------------------------------

    let saveDebounce = null;

    noteEl.addEventListener("input", () => {
        updateCount();
        clearTimeout(saveDebounce);
        saveDebounce = setTimeout(() => {
            saveNote(noteEl.value);
            flashSaved();
        }, 600);
    });

    root.getElementById("save").addEventListener("click", () => {
        saveNote(noteEl.value);
        flashSaved();
    });

    root.getElementById("clear").addEventListener("click", () => {
        if (!confirm("이 방의 노트를 비울까요?")) return;
        noteEl.value = "";
        saveNote("");
        updateCount();
        flashSaved();
    });

    enabledEl.addEventListener("change", () => {
        setEnabled(enabledEl.checked);
    });

    //------------------------------------------
    // 방 이동 감지 (SPA 라우팅 대응)
    // - 피드백 2: 대화방마다 노트를 다르게 저장
    //------------------------------------------

    setInterval(() => {
        const id = currentRoomId();
        if (id !== roomId) {
            roomId = id;
            noteKey = `zeta-usernote-${roomId}`;
            refreshRoomUI();
        }
    }, 1000);

    //------------------------------------------
    // fetch 가로채기: 입력창에는 안 보이고, 전송되는 요청에만 삽입
    //------------------------------------------

    function buildInjected(userInput) {
        const note = getNote();
        if (!note || !isEnabled()) return userInput;
        if (userInput.startsWith(NOTE_TAG)) return userInput;
        return `${NOTE_TAG}\n${note}\n\n[사용자 입력]\n${userInput}`;
    }

    const originalFetch = window.fetch;

    window.fetch = async function (input, init) {

        try {
            const url = typeof input === "string" ? input : (input && input.url) || "";
            const method = (
                (init && init.method) ||
                (typeof input !== "string" && input && input.method) ||
                "GET"
            ).toUpperCase();

            if (method === "POST" && STREAM_URL_RE.test(url) && init && init.body) {

                const bodyObj = JSON.parse(init.body);

                if (bodyObj && bodyObj.type === "TEXT" && typeof bodyObj.text === "string") {
                    bodyObj.text = buildInjected(bodyObj.text);
                    init = Object.assign({}, init, { body: JSON.stringify(bodyObj) });
                    console.log("📝 User Note 주입됨:", bodyObj.text.slice(0, 80) + "...");
                }
            }
        } catch (err) {
            console.error("❌ User Note 주입 실패, 원본 요청 그대로 전송", err);
        }

        return originalFetch.call(this, input, init);
    };

    //------------------------------------------
    // Public API
    //------------------------------------------

    window.ZetaUserNote = {
        version: VERSION,
        getNote,
        saveNote,
        isEnabled,
        setEnabled,
        get roomId() { return roomId; }
    };

    console.log(`📝 Zeta UserNote v${VERSION} Ready`);

})();
