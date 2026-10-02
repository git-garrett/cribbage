import { RecentAuthenticationRequiredError } from "./auth-recovery";

type AccountSettings = {
  smsEnabled: boolean;
  phone: { number: string; verified: boolean } | null;
  hasPassword: boolean;
  recentSignIn: boolean;
};
type PendingPhone = { challenge: string; phone: string };
type Options = {
  request: <T>(path: string, body?: Record<string, unknown>) => Promise<T>;
  reauthenticate: () => void;
};

export function createAccountSecurity(options: Options): { show(userId: number): void; hide(): void } {
  const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const root = element("account-security");
  const controls = element<HTMLFieldSetElement>("account-security-controls");
  const reauth = element("account-reauth");
  const status = element("account-security-status");
  const phoneForm = element<HTMLFormElement>("account-phone-form");
  const phoneInput = element<HTMLInputElement>("account-phone");
  const phoneSummary = element("account-phone-summary");
  const phoneStatus = element("account-phone-status");
  const phoneSend = element<HTMLButtonElement>("account-phone-send");
  const phoneRemove = element<HTMLButtonElement>("account-phone-remove");
  const codeForm = element<HTMLFormElement>("account-phone-code-form");
  const codeInput = element<HTMLInputElement>("account-phone-code");
  const codeDescription = element("account-phone-code-description");
  const passwordForm = element<HTMLFormElement>("account-password-form");
  const passwordInput = element<HTMLInputElement>("account-new-password");
  const passwordConfirm = element<HTMLInputElement>("account-confirm-password");
  const passwordSummary = element("account-password-summary");
  const passwordSave = element<HTMLButtonElement>("account-password-save");
  const passwordStatus = element("account-password-status");
  let owner: number | null = null;
  let generation = 0;
  let settings: AccountSettings | null = null;
  let pending: PendingPhone | null = null;
  let busy = false;
  let needsSignIn = false;

  function render(): void {
    controls.disabled = busy || !settings || needsSignIn;
    reauth.hidden = !needsSignIn;
    phoneForm.hidden = Boolean(pending);
    codeForm.hidden = !pending;
    phoneRemove.hidden = !settings?.phone || Boolean(pending);
    phoneSend.disabled = !settings?.smsEnabled;
    if (pending) codeDescription.textContent = `Enter the code sent to ${pending.phone}. Your current number stays active until verification succeeds.`;
    if (!settings) return;
    phoneSummary.textContent = settings.phone
      ? `${settings.phone.number} · ${settings.phone.verified ? "Verified for SMS sign-in" : "Awaiting verification"}`
      : "No phone number added. Email and password sign-in remain available.";
    if (!settings.smsEnabled) phoneSummary.textContent += " Text verification is temporarily unavailable.";
    passwordSummary.textContent = settings.hasPassword
      ? "Update your password here. Other sessions will be signed out."
      : "Set a password to add another way to sign in.";
    passwordSave.textContent = settings.hasPassword ? "Update password" : "Set password";
  }

  function report(error: unknown, target: HTMLElement): void {
    target.textContent = error instanceof Error ? error.message : "Account settings could not be updated.";
    if (error instanceof RecentAuthenticationRequiredError) {
      needsSignIn = true;
      passwordForm.reset();
    }
    render();
  }

  async function load(version: number): Promise<void> {
    const result = await options.request<AccountSettings>("/api/auth/account");
    if (version !== generation) return;
    settings = result;
    needsSignIn = !result.recentSignIn;
    phoneInput.value = result.phone?.number || "";
    render();
  }

  async function action(target: HTMLElement, work: (version: number) => Promise<void>): Promise<void> {
    if (busy || owner === null || needsSignIn) return;
    const version = generation;
    busy = true;
    render();
    try { await work(version); }
    catch (error) { if (version === generation) report(error, target); }
    finally { if (version === generation) { busy = false; render(); } }
  }

  async function send(phone: string, version: number): Promise<void> {
    phoneStatus.textContent = "Sending a verification code…";
    const result = await options.request<PendingPhone>("/api/auth/account/phone/request", { phone });
    if (version !== generation) return;
    pending = result;
    codeInput.value = "";
    phoneStatus.textContent = "Code sent. Enter it within ten minutes.";
    render();
    window.setTimeout(() => { if (version === generation) codeInput.focus(); }, 0);
  }

  phoneForm.addEventListener("submit", event => {
    event.preventDefault();
    if (phoneForm.reportValidity()) void action(phoneStatus, version => send(phoneInput.value, version));
  });
  element("account-phone-resend").addEventListener("click", () => {
    if (pending) void action(phoneStatus, version => send(pending!.phone, version));
  });
  element("account-phone-cancel").addEventListener("click", () => {
    pending = null;
    codeForm.reset();
    phoneStatus.textContent = "Phone change canceled.";
    render();
  });
  codeForm.addEventListener("submit", event => {
    event.preventDefault();
    if (!pending || !codeForm.reportValidity()) return;
    void action(phoneStatus, async version => {
      await options.request("/api/auth/account/phone/verify", { challenge: pending!.challenge, code: codeInput.value });
      if (version !== generation) return;
      pending = null;
      codeForm.reset();
      await load(version);
      if (version === generation) phoneStatus.textContent = "Phone verified. SMS sign-in is enabled.";
    });
  });
  phoneRemove.addEventListener("click", () => {
    void action(phoneStatus, async version => {
      await options.request("/api/auth/account/phone/remove", {});
      if (version !== generation) return;
      pending = null;
      await load(version);
      if (version === generation) phoneStatus.textContent = "Phone removed. SMS sign-in is disabled.";
    });
  });
  passwordConfirm.addEventListener("input", () => passwordConfirm.setCustomValidity(""));
  passwordInput.addEventListener("input", () => passwordConfirm.setCustomValidity(""));
  passwordForm.addEventListener("submit", event => {
    event.preventDefault();
    passwordConfirm.setCustomValidity(passwordConfirm.value === passwordInput.value ? "" : "Passwords must match.");
    if (!passwordForm.reportValidity()) return;
    void action(passwordStatus, async version => {
      await options.request("/api/auth/account/password", { password: passwordInput.value });
      if (version !== generation) return;
      passwordForm.reset();
      pending = null;
      codeForm.reset();
      await load(version);
      if (version === generation) passwordStatus.textContent = "Password updated. Other sessions have been signed out.";
    });
  });
  element("account-reauth-button").addEventListener("click", () => { hide(); options.reauthenticate(); });

  function hide(): void {
    generation += 1;
    owner = null;
    settings = null;
    pending = null;
    busy = false;
    needsSignIn = false;
    root.hidden = true;
    phoneForm.reset();
    codeForm.reset();
    passwordForm.reset();
    passwordConfirm.setCustomValidity("");
    status.textContent = phoneStatus.textContent = passwordStatus.textContent = "";
    phoneSummary.textContent = "Loading sign-in methods…";
    passwordSummary.textContent = codeDescription.textContent = "";
  }

  return {
    hide,
    show(userId: number): void {
      if (owner === userId && !root.hidden) return;
      hide();
      owner = userId;
      root.hidden = false;
      render();
      const version = generation;
      void load(version).catch(error => { if (version === generation) report(error, status); });
    },
  };
}
