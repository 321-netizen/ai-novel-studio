const billingEmail = document.querySelector("#billing-email");
const billingRole = document.querySelector("#billing-role");
const billingBalance = document.querySelector("#billing-balance");
const billingSubscription = document.querySelector("#billing-subscription");
const billingPurchased = document.querySelector("#billing-purchased");
const billingSideMeta = document.querySelector("#billing-side-meta");
const billingSideEmail = document.querySelector("#billing-side-email");
const billingSideRole = document.querySelector("#billing-side-role");
const billingCreated = document.querySelector("#billing-created");
const billingPackages = document.querySelector("#billing-packages");
const billingRequests = document.querySelector("#billing-requests");
const billingSummaryBalance = document.querySelector("#billing-summary-balance");
const billingSummaryConsumed = document.querySelector("#billing-summary-consumed");
const billingScrollRechargeButton = document.querySelector("#billing-scroll-recharge-btn");
const billingLogoutButton = document.querySelector("#billing-logout-btn");
const billingCopyQqButton = document.querySelector("#billing-copy-qq-btn");

const PAYMENT_QQ = "2133275641";

function setAdminOnlyVisibility(isAdmin) {
  document.querySelectorAll(".admin-only-link").forEach((node) => {
    node.classList.toggle("is-visible", Boolean(isAdmin));
  });
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString("zh-CN") : "暂无";
}

function formatCredits(value) {
  return `${Number(value || 0)} 星币`;
}

function formatCreditNumber(value) {
  return String(Number(value || 0));
}

function formatPrice(value) {
  return `¥ ${Number(value || 0).toFixed(Number.isInteger(Number(value || 0)) ? 0 : 1)}`;
}

function renderSessionBar(user) {
  const sessionBar = document.createElement("div");
  sessionBar.className = "session-bar";
  sessionBar.innerHTML = `
    <span>当前登录：<strong>${user.email}</strong></span>
    <button id="header-logout-btn" class="ghost-btn small-btn" type="button">退出登录</button>
  `;
  const target = document.querySelector("#billing-session-slot") || document.querySelector(".hero-copy");
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
}

function renderRechargePackages(packages) {
  if (!packages.length) {
    billingPackages.innerHTML = '<p class="empty-copy">暂无充值套餐。</p>';
    return;
  }

  billingPackages.innerHTML = packages
    .map((item) => `
      <article class="billing-package-card">
        <span>${item.name}</span>
        <strong>${formatPrice(item.priceCny)}</strong>
        <p>${item.description || "适合稳定创作使用。"}</p>
        <div class="saved-item-meta">
          <span>基础 ${item.credits} 星币</span>
          <span>赠送 ${item.bonusCredits} 星币</span>
          <span>到账共 ${item.totalCredits} 星币</span>
        </div>
        <button class="primary-btn" type="button" data-package-id="${item.id}">提交充值申请</button>
      </article>
    `)
    .join("");

  billingPackages.querySelectorAll("[data-package-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const confirmed = window.confirm("确认提交这笔充值申请吗？提交后可在后台人工确认到账。");
      if (!confirmed) {
        return;
      }

      try {
        const response = await fetch("/api/billing/recharge-request", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ packageId: button.dataset.packageId })
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "提交失败");
        }
        await loadBilling();
        window.alert(`充值申请已提交。\n\n请联系 QQ：${PAYMENT_QQ}\n并备注你的注册邮箱，我确认到账后会给你加星币。`);
      } catch (error) {
        window.alert(`提交失败：${error.message}`);
      }
    });
  });
}

function renderRechargeRequests(requests) {
  if (!requests.length) {
    billingRequests.innerHTML = '<p class="empty-copy">你还没有提交过充值申请。</p>';
    return;
  }

  billingRequests.innerHTML = requests
    .map((item) => `
      <article class="admin-user-row">
        <div class="admin-user-main">
          <strong>${item.packageName}</strong>
          <div class="saved-item-meta">
            <span>${formatPrice(item.priceCny)}</span>
            <span>${item.totalCredits} 星币</span>
            <span>${formatDate(item.createdAt)}</span>
          </div>
          <p>状态：${item.status === "approved" ? "已到账" : item.status === "rejected" ? "已拒绝" : "等待确认"}${item.note ? ` · ${item.note}` : ""}</p>
        </div>
      </article>
    `)
    .join("");
}

function renderBilling(user, requests, packages) {
  const roleLabel = user.role === "admin" ? "管理员" : "普通用户";
  const subscriptionLabel = user.subscription === "pro" ? "专业版" : "基础版";
  const consumedCredits = Math.max(0, Number(user.totalPurchasedCredits || 0) - Number(user.creditBalance || 0));

  billingEmail.textContent = user.email;
  billingRole.textContent = roleLabel;
  billingBalance.textContent = formatCredits(user.creditBalance);
  billingPurchased.textContent = formatCredits(user.totalPurchasedCredits);
  billingSummaryBalance.textContent = formatCreditNumber(user.creditBalance);
  billingSummaryConsumed.textContent = formatCreditNumber(consumedCredits);
  billingSubscription.textContent = `${subscriptionLabel} · 可提交充值申请`;
  billingSideEmail.textContent = PAYMENT_QQ;
  billingSideRole.textContent = user.email;
  billingCreated.textContent = "先提交申请，再联系付款";
  billingSideMeta.textContent = `当前账号 ${user.email} · 当前余额 ${formatCredits(user.creditBalance)} · 提交申请后请联系 QQ ${PAYMENT_QQ}`;

  renderRechargePackages(packages || []);
  renderRechargeRequests(requests || []);
}

async function loadBilling() {
  const response = await fetch("/api/billing");
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "读取充值中心失败");
  }
  renderBilling(data.user, data.requests || [], data.packages || []);
}

billingLogoutButton.addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/auth.html";
});

billingCopyQqButton?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(PAYMENT_QQ);
    window.alert(`QQ 号已复制：${PAYMENT_QQ}`);
  } catch (error) {
    window.alert(`请手动复制 QQ：${PAYMENT_QQ}`);
  }
});

billingScrollRechargeButton?.addEventListener("click", () => {
  document.querySelector("#billing-packages-section")?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
});

Promise.resolve()
  .then(() => requireUserSession())
  .then(() => loadBilling())
  .catch(() => {});
