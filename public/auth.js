const loginForm = document.querySelector("#login-form");
const codeForm = document.querySelector("#code-form");
const registerForm = document.querySelector("#register-form");
const authStatus = document.querySelector("#auth-status");
const sendCodeButton = document.querySelector("#send-code-btn");

function setStatus(text) {
  authStatus.textContent = text;
}

function collectFormData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function routeAfterLogin(user) {
  window.location.href = user.role === "admin" ? "/admin.html" : "/user.html";
}

async function submitAuth(url, payload, pendingText) {
  setStatus(pendingText);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "操作失败");
  }
  return data;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await submitAuth("/api/auth/login", collectFormData(loginForm), "正在登录...");
    setStatus("登录成功，正在跳转...");
    routeAfterLogin(data.user);
  } catch (error) {
    setStatus(`登录失败：${error.message}`);
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await submitAuth("/api/auth/register", collectFormData(registerForm), "正在注册...");
    setStatus("注册成功，正在进入用户端...");
    routeAfterLogin(data.user);
  } catch (error) {
    setStatus(`注册失败：${error.message}`);
  }
});

sendCodeButton.addEventListener("click", async () => {
  const payload = collectFormData(codeForm);
  try {
    const data = await submitAuth(
      "/api/auth/send-login-code",
      { email: payload.email },
      "正在发送验证码..."
    );

    const devHint = data.delivery === "dev" && data.code
      ? ` 当前为本地开发模式，验证码：${data.code}`
      : "";
    setStatus(`验证码已发送，请查收邮箱。${devHint}`);
  } catch (error) {
    setStatus(`发送失败：${error.message}`);
  }
});

codeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await submitAuth(
      "/api/auth/login-code",
      collectFormData(codeForm),
      "正在验证验证码..."
    );
    const extra = data.autoRegistered ? " 已自动创建新用户。" : "";
    setStatus(`验证码登录成功，正在跳转...${extra}`);
    routeAfterLogin(data.user);
  } catch (error) {
    setStatus(`验证码登录失败：${error.message}`);
  }
});
