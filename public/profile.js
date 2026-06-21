const profileEmail = document.querySelector("#profile-email");
const profileRole = document.querySelector("#profile-role");
const profileCreated = document.querySelector("#profile-created");
const profileTotal = document.querySelector("#profile-total");
const profileAssist = document.querySelector("#profile-assist");
const profileAuto = document.querySelector("#profile-auto");
const profileWords = document.querySelector("#profile-words");
const profileWorks = document.querySelector("#profile-works");
const profileSideMeta = document.querySelector("#profile-side-meta");
const profileSideEmail = document.querySelector("#profile-side-email");
const profileSideRole = document.querySelector("#profile-side-role");
const profileLatestCreated = document.querySelector("#profile-latest-created");
const profileLogoutButton = document.querySelector("#profile-logout-btn");
const profileBalance = document.querySelector("#profile-balance");
const profileSubscription = document.querySelector("#profile-subscription");
const profilePurchased = document.querySelector("#profile-purchased");

function setAdminOnlyVisibility(isAdmin) {
  document.querySelectorAll(".admin-only-link").forEach((node) => {
    node.classList.toggle("is-visible", Boolean(isAdmin));
  });
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString("zh-CN") : "暂无";
}

function renderSessionBar(user) {
  const sessionBar = document.createElement("div");
  sessionBar.className = "session-bar";
  sessionBar.innerHTML = `
    <span>当前登录：<strong>${user.email}</strong></span>
    <button id="header-logout-btn" class="ghost-btn small-btn" type="button">退出登录</button>
  `;
  const target = document.querySelector("#profile-session-slot") || document.querySelector(".hero-copy");
  target.appendChild(sessionBar);
  sessionBar.querySelector("#header-logout-btn").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/auth.html";
  });
}

async function requireUserSession() {
  const response = await fetch("/api/auth/me");
  const data = await response.json();
  if (!response.ok || !data.user) {
    window.location.href = "/auth.html";
    throw new Error("未登录");
  }
  setAdminOnlyVisibility(data.user.role === "admin");
  renderSessionBar(data.user);
  return data.user;
}

function formatCredits(value) {
  return `${Number(value || 0)} 星币`;
}

function renderProfile(user, stats, recentWorks) {
  const roleLabel = user.role === "admin" ? "管理员" : "普通用户";
  const subscriptionLabel = user.subscription === "pro" ? "专业版" : "基础版";

  profileEmail.textContent = user.email;
  profileRole.textContent = roleLabel;
  profileCreated.textContent = formatDate(user.createdAt);
  profileTotal.textContent = String(stats.totalWorks || 0);
  profileAssist.textContent = String(stats.assistCount || 0);
  profileAuto.textContent = String(stats.autoCount || 0);
  profileWords.textContent = String(stats.totalWords || 0);
  profileSideEmail.textContent = user.email;
  profileSideRole.textContent = roleLabel;
  profileLatestCreated.textContent = formatDate(stats.latestCreatedAt);
  profileSideMeta.textContent = `${roleLabel} · 已保存 ${stats.totalWorks || 0} 篇作品`;
  profileBalance.textContent = formatCredits(user.creditBalance);
  profilePurchased.textContent = formatCredits(user.totalPurchasedCredits);
  profileSubscription.textContent = `${subscriptionLabel} · 可从顶部导航进入独立充值中心`;

  if (!recentWorks.length) {
    profileWorks.innerHTML = '<p class="empty-copy">你还没有保存过作品。</p>';
    return;
  }

  profileWorks.innerHTML = recentWorks
    .map((work) => `
      <article class="admin-work-row">
        <div class="admin-work-main">
          <strong>${work.title}</strong>
          <p>${work.excerpt || "暂无摘要"}</p>
          <div class="saved-item-meta">
            <span>${work.mode === "assist" ? "辅助型" : "自动型"}</span>
            <span>${work.wordCount} 字</span>
            <span>${formatDate(work.createdAt)}</span>
          </div>
        </div>
      </article>
    `)
    .join("");
}

async function loadProfile() {
  const response = await fetch("/api/profile");
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "读取个人中心失败");
  }
  renderProfile(data.user, data.stats || {}, data.recentWorks || []);
}

profileLogoutButton.addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/auth.html";
});

Promise.resolve()
  .then(() => requireUserSession())
  .then(() => loadProfile())
  .catch(() => {});
