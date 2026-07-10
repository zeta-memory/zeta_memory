(() => {
    console.log("🧠 Zeta Memory Loaded v0.0.1");

    // 이미 실행 중이면 중복 생성 방지
    if (document.getElementById("zeta-memory-panel")) return;

    const panel = document.createElement("div");
    panel.id = "zeta-memory-panel";

    panel.innerHTML = `
        <div style="font-weight:bold;">🧠 Zeta Memory</div>
        <div>v0.0.1</div>
    `;

    Object.assign(panel.style, {
        position: "fixed",
        right: "16px",
        bottom: "80px",
        background: "#1f1f1f",
        color: "white",
        padding: "10px 14px",
        borderRadius: "12px",
        zIndex: 999999,
        fontSize: "13px",
        boxShadow: "0 4px 12px rgba(0,0,0,.4)",
        fontFamily: "sans-serif"
    });

    document.body.appendChild(panel);
})();
