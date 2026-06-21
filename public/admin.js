const adminProvider = document.querySelector("#admin-provider");
const adminModel = document.querySelector("#admin-model");
const adminCount = document.querySelector("#admin-count");
const adminWords = document.querySelector("#admin-words");
const statTotal = document.querySelector("#stat-total");
const statAssist = document.querySelector("#stat-assist");
const statAuto = document.querySelector("#stat-auto");
const statWords = document.querySelector("#stat-words");
const adminWorks = document.querySelector("#admin-works");
const adminUsers = document.querySelector("#admin-users");
const adminRechargeRequests = document.querySelector("#admin-recharge-requests");
const adminPreview = document.querySelector("#admin-preview");
const adminPreviewMeta = document.querySelector("#admin-preview-meta");

function formatDate(value) {
  return value ? new Date(value).toLocaleString("zh-CN") : "暂无";
}

function renderSessionBar(user) {
  const sessionBar = document.createElement("div");
  sessionBar.className = "session-bar";
  sessionBar.innerHTML = `
    <span>管理员：<strong>${user.email}</strong></span>
    <button id="logout-btn" class="ghost-btn small-btn" type="button">退出登录</button>
  `;
  const target = document.querySelector("#admin-session-slot") || document.querySelector(".hero-copy");
  target.appendChild(sessionBar);
  sessionBar.querySelector("#logout-btn").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/auth.html";
  });
}

async function requireAdminSession() {
  const response = await fetch("/api/auth/me");
  const data = await response.json();
  if (!response.ok || !data.user) {
    window.location.href = "/auth.html";
    throw new Error("未登录");
  }
  if (data.user.role !== "admin") {
    window.location.href = "/user.html";
    throw new Error("不是管理员");
  }
  renderSessionBar(data.user);
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "读取配置失败");
    }
    adminProvider.textContent = data.provider;
    adminModel.textContent = data.model;
  } catch (error) {
    adminProvider.textContent = "读取失败";
    adminModel.textContent = "请检查服务";
  }
}

function renderStats(stats) {
  adminCount.textContent = `${stats.totalWorks || 0} 篇作品`;
  adminWords.textContent = `${stats.totalWords || 0} 字`;
  statTotal.textContent = String(stats.totalWorks || 0);
  statAssist.textContent = String(stats.assistCount || 0);
  statAuto.textContent = String(stats.autoCount || 0);
  statWords.textContent = String(stats.totalWords || 0);
}

function getSubscriptionLabel(user) {
  return user.subscription === "pro" ? "专业版" : "基础版";
}

function formatPrice(value) {
  return `¥ ${Number(value || 0).toFixed(Number.isInteger(Number(value || 0)) ? 0 : 1)}`;
}

function formatCredits(value) {
  return `${Number(value || 0)} 星币`;
}

async function loadWorkDetail(id) {
  try {
    const response = await fetch(`/api/works/${id}`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "读取详情失败");
    }

    const work = data.work;
    adminPreviewMeta.textContent = `${work.title} · ${work.userEmail} · ${formatDate(work.createdAt)} · ${work.wordCount} 字`;
    adminPreview.textContent = [
      `标题：${work.title}`,
      `作者：${work.userEmail}`,
      `模式：${work.mode === "assist" ? "灵感辅助型" : "全自动生成型"}`,
      `模型：${work.provider} / ${work.model}`,
      "",
      "输入摘要：",
      work.inputSummary || "无",
      "",
      "正文：",
      work.content || ""
    ].join("\n");
  } catch (error) {
    adminPreviewMeta.textContent = "读取详情失败";
    adminPreview.textContent = error.message;
  }
}

async function deleteWork(id) {
  const confirmed = window.confirm("确定要删除这篇作品吗？");
  if (!confirmed) {
    return;
  }

  try {
    const response = await fetch(`/api/works/${id}`, {
      method: "DELETE"
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "删除失败");
    }

    adminPreviewMeta.textContent = "选择一篇作品后显示详情。";
    adminPreview.textContent = "这里会显示作品正文和输入摘要。";
    await loadAdminStats();
  } catch (error) {
    window.alert(`删除失败：${error.message}`);
  }
}

function renderWorks(works) {
  if (!works.length) {
    adminWorks.innerHTML = '<p class="empty-copy">暂无作品。</p>';
    return;
  }

  adminWorks.innerHTML = works
    .map((work) => `
      <article class="admin-work-row">
        <div class="admin-work-main">
          <strong>${work.title}</strong>
          <p>${work.excerpt || "暂无摘要"}</p>
          <div class="saved-item-meta">
            <span>用户：${work.userEmail}</span>
            <span>${work.mode === "assist" ? "辅助型" : "自动型"}</span>
            <span>${work.wordCount} 字</span>
            <span>${formatDate(work.createdAt)}</span>
          </div>
        </div>
        <div class="admin-work-actions">
          <button class="secondary-btn small-btn" data-view-id="${work.id}">预览</button>
          <button class="ghost-btn small-btn" data-delete-id="${work.id}">删除</button>
        </div>
      </article>
    `)
    .join("");

  adminWorks.querySelectorAll("[data-view-id]").forEach((button) => {
    button.addEventListener("click", () => {
      loadWorkDetail(button.dataset.viewId);
    });
  });

  adminWorks.querySelectorAll("[data-delete-id]").forEach((button) => {
    button.addEventListener("click", () => {
      deleteWork(button.dataset.deleteId);
    });
  });
}

async function updateUserSubscription(userId, subscription) {
  try {
    const response = await fetch(`/api/admin/users/${userId}/subscription`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ subscription })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "更新权限失败");
    }

    await loadAdminStats();
  } catch (error) {
    window.alert(`更新失败：${error.message}`);
  }
}

async function grantCreditsToUser(userId) {
  const rawValue = window.prompt("请输入要给这个用户直接充值的星币数量");
  if (rawValue === null) {
    return;
  }

  const amount = Math.floor(Number(rawValue));
  if (!Number.isFinite(amount) || amount <= 0) {
    window.alert("请输入大于 0 的整数星币数量");
    return;
  }

  try {
    const response = await fetch(`/api/admin/users/${userId}/credits`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ amount })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "充值失败");
    }

    await loadAdminStats();
    window.alert(`已成功给该用户充值 ${amount} 星币`);
  } catch (error) {
    window.alert(`充值失败：${error.message}`);
  }
}

function renderUsers(users) {
  if (!users.length) {
    adminUsers.innerHTML = '<p class="empty-copy">暂无用户。</p>';
    return;
  }

  adminUsers.innerHTML = users
    .map((user) => `
      <article class="admin-user-row">
        <div class="admin-user-main">
          <strong>${user.email}</strong>
          <div class="saved-item-meta">
            <span>身份：${user.role === "admin" ? "管理员" : "普通用户"}</span>
            <span>当前套餐：${getSubscriptionLabel(user)}</span>
            <span>当前余额：${formatCredits(user.creditBalance)}</span>
            <span>注册时间：${formatDate(user.createdAt)}</span>
          </div>
          <p>
            ${user.upgradeRequestedAt
              ? `已提交专业版申请：${formatDate(user.upgradeRequestedAt)}`
              : user.subscription === "pro"
                ? `专业版已开通：${formatDate(user.proEnabledAt)}`
                : "当前没有专业版申请"}
          </p>
        </div>
        <div class="admin-work-actions">
          ${user.role === "admin"
            ? '<span class="admin-role-badge">管理员账号</span>'
            : `
              <button class="secondary-btn small-btn" data-user-credit-id="${user.id}">直接充星币</button>
              ${user.subscription === "pro"
                ? `<button class="ghost-btn small-btn" data-user-subscription-id="${user.id}" data-next-subscription="basic">关闭专业版</button>`
                : `<button class="secondary-btn small-btn" data-user-subscription-id="${user.id}" data-next-subscription="pro">开通专业版</button>`
              }
            `
          }
        </div>
      </article>
    `)
    .join("");

  adminUsers.querySelectorAll("[data-user-credit-id]").forEach((button) => {
    button.addEventListener("click", () => {
      grantCreditsToUser(button.dataset.userCreditId);
    });
  });

  adminUsers.querySelectorAll("[data-user-subscription-id]").forEach((button) => {
    button.addEventListener("click", () => {
      updateUserSubscription(button.dataset.userSubscriptionId, button.dataset.nextSubscription);
    });
  });
}

async function processRechargeRequest(requestId, action) {
  try {
    const response = await fetch(`/api/admin/recharge-requests/${requestId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "处理充值申请失败");
    }
    await loadAdminStats();
  } catch (error) {
    window.alert(`处理失败：${error.message}`);
  }
}

function renderRechargeRequests(requests) {
  if (!requests.length) {
    adminRechargeRequests.innerHTML = '<p class="empty-copy">暂无充值申请。</p>';
    return;
  }

  adminRechargeRequests.innerHTML = requests
    .map((item) => `
      <article class="admin-user-row">
        <div class="admin-user-main">
          <strong>${item.userEmail || "未知用户"} · ${item.packageName}</strong>
          <div class="saved-item-meta">
            <span>${formatPrice(item.priceCny)}</span>
            <span>到账 ${item.totalCredits} 星币</span>
            <span>${formatDate(item.createdAt)}</span>
          </div>
          <p>状态：${item.status === "approved" ? "已到账" : item.status === "rejected" ? "已拒绝" : "等待确认"}${item.note ? ` · ${item.note}` : ""}</p>
        </div>
        <div class="admin-work-actions">
          ${item.status === "pending"
            ? `
              <button class="secondary-btn small-btn" data-recharge-id="${item.id}" data-recharge-action="approve">确认到账</button>
              <button class="ghost-btn small-btn" data-recharge-id="${item.id}" data-recharge-action="reject">拒绝</button>
            `
            : `<span class="admin-role-badge">${item.status === "approved" ? "已到账" : "已拒绝"}</span>`
          }
        </div>
      </article>
    `)
    .join("");

  adminRechargeRequests.querySelectorAll("[data-recharge-id]").forEach((button) => {
    button.addEventListener("click", () => {
      processRechargeRequest(button.dataset.rechargeId, button.dataset.rechargeAction);
    });
  });
}

async function loadAdminStats() {
  try {
    const response = await fetch("/api/admin/stats");
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "读取统计失败");
    }

    renderStats(data.stats || {});
    renderWorks(data.latestWorks || []);
    renderUsers(data.users || []);
    renderRechargeRequests(data.rechargeRequests || []);
  } catch (error) {
    adminWorks.innerHTML = '<p class="empty-copy">读取后台数据失败。</p>';
    adminUsers.innerHTML = '<p class="empty-copy">读取用户列表失败。</p>';
    adminRechargeRequests.innerHTML = '<p class="empty-copy">读取充值申请失败。</p>';
  }
}

Promise.resolve()
  .then(() => requireAdminSession())
  .then(() => loadConfig())
  .then(() => loadAdminStats())
  .catch(() => {});
