(() => {
  "use strict";

  const form = document.querySelector("#login-form");
  const emailInput = document.querySelector("#email");
  const passwordInput = document.querySelector("#password");
  const passwordToggle = document.querySelector("#password-toggle");
  const rememberInput = document.querySelector("#remember");
  const submitButton = document.querySelector("#submit-button");
  const message = document.querySelector("#form-message");
  const toast = document.querySelector("#toast");
  const forgotPasswordButton = document.querySelector("#forgot-password");
  const requestAccessButton = document.querySelector("#request-access");
  const ssoButtons = document.querySelectorAll("[data-provider]");
  const brandPanel = document.querySelector(".brand-panel");
  const authChamber = document.querySelector(".auth-chamber");

  const STORAGE_KEY = "aurelle.rememberedEmail";
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const desktopPointerQuery = window.matchMedia("(pointer: fine) and (min-width: 1024px)");
  let toastTimer = null;
  let successTimer = null;

  const setMessage = (text = "", type = "") => {
    message.textContent = text;
    message.className = "form-message";

    if (!text) {
      message.hidden = true;
      return;
    }

    message.hidden = false;
    if (type) message.classList.add(`is-${type}`);
  };

  const showToast = (text) => {
    toast.textContent = text;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 3200);
  };

  const setFieldError = (input, text = "", shouldShake = false) => {
    const field = input.closest(".field");
    const error = field?.querySelector(".field-error");

    if (!field || !error) return;

    error.textContent = text;
    field.classList.toggle("has-error", Boolean(text));
    input.setAttribute("aria-invalid", text ? "true" : "false");

    if (text && shouldShake) {
      field.classList.remove("is-shaking");
      requestAnimationFrame(() => {
        field.classList.add("is-shaking");
      });
      window.setTimeout(() => field.classList.remove("is-shaking"), 320);
    }
  };

  const validateEmail = (shouldShake = false) => {
    const value = emailInput.value.trim();
    let error = "";

    if (!value) {
      error = "Please enter your email address.";
    } else if (!emailInput.validity.valid) {
      error = "Enter a valid email address, such as name@example.com.";
    }

    setFieldError(emailInput, error, shouldShake);
    return !error;
  };

  const validatePassword = (shouldShake = false) => {
    const value = passwordInput.value;
    let error = "";

    if (!value) {
      error = "Please enter your password.";
    } else if (value.length < 8) {
      error = "Password must contain at least 8 characters.";
    }

    setFieldError(passwordInput, error, shouldShake);
    return !error;
  };

  const restoreRememberedEmail = () => {
    try {
      const rememberedEmail = window.localStorage.getItem(STORAGE_KEY);
      if (rememberedEmail) {
        emailInput.value = rememberedEmail;
        rememberInput.checked = true;
      }
    } catch {
      // Storage may be blocked by the browser. The login form remains usable.
    }
  };

  const persistRememberedEmail = () => {
    try {
      if (rememberInput.checked) {
        window.localStorage.setItem(STORAGE_KEY, emailInput.value.trim());
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Ignore unavailable storage; remembering the email is optional.
    }
  };

  const setLoading = (isLoading) => {
    if (isLoading) {
      window.clearTimeout(successTimer);
      submitButton.classList.remove("is-success");
      authChamber?.classList.remove("is-auth-success");
    }

    submitButton.disabled = isLoading;
    submitButton.classList.toggle("is-loading", isLoading);
    submitButton.setAttribute("aria-busy", String(isLoading));
    emailInput.disabled = isLoading;
    passwordInput.disabled = isLoading;
    rememberInput.disabled = isLoading;
    passwordToggle.disabled = isLoading;
  };

  const playSuccessMotion = () => {
    submitButton.classList.remove("is-success");
    authChamber?.classList.remove("is-auth-success");

    requestAnimationFrame(() => {
      submitButton.classList.add("is-success");
      authChamber?.classList.add("is-auth-success");
    });

    successTimer = window.setTimeout(() => {
      submitButton.classList.remove("is-success");
      authChamber?.classList.remove("is-auth-success");
    }, reducedMotionQuery.matches ? 180 : 1150);
  };

  const setupSovereignParallax = () => {
    if (!brandPanel) return;

    let frameId = 0;
    const target = { x: 0, y: 0 };
    const current = { x: 0, y: 0 };

    const writeMotion = () => {
      brandPanel.style.setProperty("--glow-x", `${(current.x * 4).toFixed(2)}px`);
      brandPanel.style.setProperty("--glow-y", `${(current.y * 4).toFixed(2)}px`);
      brandPanel.style.setProperty("--grid-x", `${(current.x * 6).toFixed(2)}px`);
      brandPanel.style.setProperty("--grid-y", `${(current.y * 6).toFixed(2)}px`);
      brandPanel.style.setProperty("--orbit-x", `${(current.x * 12).toFixed(2)}px`);
      brandPanel.style.setProperty("--orbit-y", `${(current.y * 12).toFixed(2)}px`);
    };

    const tick = () => {
      const lerp = 0.065;
      current.x += (target.x - current.x) * lerp;
      current.y += (target.y - current.y) * lerp;
      writeMotion();

      if (Math.abs(target.x - current.x) > 0.002 || Math.abs(target.y - current.y) > 0.002) {
        frameId = requestAnimationFrame(tick);
      } else {
        current.x = target.x;
        current.y = target.y;
        writeMotion();
        frameId = 0;
      }
    };

    const startFrame = () => {
      if (!frameId) frameId = requestAnimationFrame(tick);
    };

    const resetParallax = () => {
      target.x = 0;
      target.y = 0;
      startFrame();
    };

    brandPanel.addEventListener("pointermove", (event) => {
      if (reducedMotionQuery.matches || !desktopPointerQuery.matches) return;
      const rect = brandPanel.getBoundingClientRect();
      target.x = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1));
      target.y = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1));
      startFrame();
    }, { passive: true });

    brandPanel.addEventListener("pointerleave", resetParallax, { passive: true });
    reducedMotionQuery.addEventListener?.("change", resetParallax);
    desktopPointerQuery.addEventListener?.("change", resetParallax);
  };

  emailInput.addEventListener("input", () => {
    if (emailInput.getAttribute("aria-invalid") === "true") validateEmail(false);
    setMessage();
  });

  emailInput.addEventListener("blur", () => {
    if (emailInput.value.trim()) validateEmail(false);
  });

  passwordInput.addEventListener("input", () => {
    if (passwordInput.getAttribute("aria-invalid") === "true") validatePassword(false);
    setMessage();
  });

  passwordInput.addEventListener("blur", () => {
    if (passwordInput.value) validatePassword(false);
  });

  passwordToggle.addEventListener("click", () => {
    const isVisible = passwordInput.type === "text";
    passwordInput.type = isVisible ? "password" : "text";
    passwordToggle.setAttribute("aria-pressed", String(!isVisible));
    passwordToggle.setAttribute("aria-label", isVisible ? "Show password" : "Hide password");
    passwordInput.focus({ preventScroll: true });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage();

    const emailValid = validateEmail(true);
    const passwordValid = validatePassword(true);

    if (!emailValid || !passwordValid) {
      setMessage("Please review the highlighted fields before continuing.", "error");
      (emailValid ? passwordInput : emailInput).focus();
      return;
    }

    persistRememberedEmail();
    setLoading(true);

    // Demonstration-only authentication delay. Replace with your real auth API call.
    await new Promise((resolve) => window.setTimeout(resolve, 850));

    setLoading(false);
    playSuccessMotion();
    setMessage(`Welcome back. Demo sign-in accepted for ${emailInput.value.trim()}.`, "success");
    showToast("Demo authentication complete — connect this form to your auth API when ready.");
  });

  forgotPasswordButton.addEventListener("click", () => {
    const email = emailInput.value.trim();
    showToast(
      email && emailInput.validity.valid
        ? `Password recovery demo for ${email}.`
        : "Enter your email first, then password recovery can continue."
    );

    if (!email || !emailInput.validity.valid) emailInput.focus();
  });

  requestAccessButton.addEventListener("click", () => {
    showToast("Access-request flow is ready to be connected to your membership system.");
  });

  ssoButtons.forEach((button) => {
    button.addEventListener("click", () => {
      showToast(`${button.dataset.provider} sign-in is a visual demo in this prototype.`);
    });
  });

  setupSovereignParallax();
  restoreRememberedEmail();
})();
