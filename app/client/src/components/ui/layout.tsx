import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  User, Building2, CreditCard, DollarSign, Users, LogOut,
  UserCheck, Shield, AlertTriangle,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "./button";
import { Badge } from "./badge";
import { roleColors } from "@/lib/auth";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { url, goTo } from "@/lib/base-path";

interface LayoutProps { children: React.ReactNode; }

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const { user, logout, isLoading } = useAuth();
  const [hasAuditLogsPermission, setHasAuditLogsPermission] = useState<boolean>(false);

  const checkAuditLogsPermission = async () => {
    try {
      const response = await apiRequest("/api/audit-logs/view-with-auth", {
        method: "POST", body: JSON.stringify({}),
      });
      const ok = response && response.length > 0 && response[0].decision;
      setHasAuditLogsPermission(ok);
    } catch { setHasAuditLogsPermission(false); }
  };

  React.useEffect(() => { if (user?.accessGranted) checkAuditLogsPermission(); }, [user]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading SecureBank...</p>
        </div>
      </div>
    );
  }

  // Not logged in — show SSO login
  if (!user) {
    return <SSOLogin />;
  }

  // Logged in but role missing — access denied
  if (!user.accessGranted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-lg w-full bg-white rounded-lg shadow-md p-8">
          <div className="text-center">
            <div className="flex justify-center mb-4">
              <div className="bg-yellow-100 rounded-full p-4">
                <AlertTriangle className="h-10 w-10 text-yellow-600" />
              </div>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Login Successful</h2>
            <p className="text-gray-600 mb-6">
              Login successful but Business operations are denied for your current role.
              Please contact App team to validate your Role details.
            </p>
            <div className="bg-gray-50 rounded-md p-4 mb-6 text-left text-sm">
              <div className="flex justify-between mb-1">
                <span className="text-gray-500">User</span>
                <span className="font-medium">{user.email}</span>
              </div>
              <div className="flex justify-between mb-1">
                <span className="text-gray-500">Auth Status</span>
                <span className="text-green-600 font-medium">Authenticated ✓</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Role</span>
                <span className="text-red-600 font-medium">Role claim missing ✗</span>
              </div>
            </div>
            <Button variant="outline" onClick={() => { goTo("/auth/logout"); }}>
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const navigation = getNavigationItems(user.role, hasAuditLogsPermission);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Building2 className="h-8 w-8 text-blue-600 mr-3" />
              <h1 className="text-xl font-semibold text-gray-900">SecureBank</h1>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <User className="h-4 w-4 text-gray-400" />
                <span className="text-sm font-medium text-gray-900">{user.name}</span>
                <Badge variant="outline" className={roleColors[user.role as keyof typeof roleColors]}>
                  {user.role}
                </Badge>
              </div>
              <Button variant="outline" size="sm" onClick={() => { goTo("/auth/logout"); }}>
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex">
        <nav className="w-64 bg-white shadow-sm min-h-screen border-r">
          <div className="p-4">
            <ul className="space-y-2">
              {navigation.map((item) => (
                <li key={item.href}>
                  <Link href={item.href}>
                    <span className={`flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                      location === item.href
                        ? "bg-blue-100 text-blue-700"
                        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                    }`}>
                      <item.icon className="h-5 w-5 mr-3" />
                      {item.label}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </nav>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}

function getNavigationItems(role: string, hasAuditLogsPermission: boolean) {
  const auditItem = { href: "/audit-logs", label: "Audit Logs", icon: Shield };

  if (role === "Administrator") {
    const items: any[] = [{ href: "/users", label: "Users", icon: Users }];
    if (hasAuditLogsPermission) items.push(auditItem);
    return items;
  }
  if (role === "Bank Manager") {
    const items: any[] = [
      { href: "/dashboard",    label: "Dashboard",    icon: Building2 },
      { href: "/accounts",     label: "Accounts",     icon: CreditCard },
      { href: "/transactions", label: "Transactions", icon: DollarSign },
      { href: "/loans",        label: "Loans",        icon: User },
    ];
    if (hasAuditLogsPermission) items.push(auditItem);
    return items;
  }
  if (role === "Bank Teller") {
    const items: any[] = [
      { href: "/dashboard",    label: "Dashboard",    icon: Building2 },
      { href: "/accounts",     label: "Accounts",     icon: CreditCard },
      { href: "/transactions", label: "Transactions", icon: DollarSign },
      { href: "/loans",        label: "Loans (View)", icon: User },
      { href: "/users",        label: "Users",        icon: Users },
    ];
    if (hasAuditLogsPermission) items.push(auditItem);
    return items;
  }
  // Account Holder
  const items: any[] = [
    { href: "/dashboard",    label: "Dashboard", icon: Building2 },
    { href: "/accounts",     label: "Accounts",  icon: CreditCard },
    { href: "/transactions", label: "Transactions", icon: DollarSign },
    { href: "/loans",        label: "My Loans",  icon: User },
  ];
  if (hasAuditLogsPermission) items.push(auditItem);
  return items;
}

interface DemoUser {
  email: string;
  name: string;
  role: string | null;
  branchId?: string | null;
  department?: string | null;
}

/**
 * Login screen. What it renders depends on AUTH_PROVIDER, which the server
 * reports via /api/auth/me (it is returned on the 401 too, precisely so this
 * screen can be drawn before anyone has signed in).
 *
 *   entra / okta → a button that redirects into the IdP
 *   none         → a picker over the seeded users, since there is no IdP to
 *                  redirect to
 *
 * Previously this hardcoded "Sign in with Microsoft" and always redirected to
 * /auth/login, which under AUTH_PROVIDER=none bounced straight back to "/" with
 * no picker — leaving no way to sign in from the browser at all.
 */
function SSOLogin() {
  const urlParams = new URLSearchParams(window.location.search);
  const [error, setError] = useState<string>(urlParams.get("error") || "");

  const [provider, setProvider] = useState<string>("");
  const [buttonLabel, setButtonLabel] = useState<string>("Sign in");
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [password, setPassword] = useState("");
  const [selected, setSelected] = useState<string>("");
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    fetch(url("/api/auth/me"), { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        const a = d?.auth || {};
        setProvider(a.provider || "");
        setButtonLabel(a.buttonLabel || "Sign in");
        if (a.provider === "none") {
          return fetch(url("/auth/users"), { credentials: "include" })
            .then((r) => r.json())
            .then((payload) => {
              setUsers(payload.users || payload || []);
              setPasswordRequired(!!payload.passwordRequired);
              // Prefilled from .config so the demo does not send people
              // hunting for a value. Server returns "" when prefill is off.
              if (payload.passwordPrefill) setPassword(payload.passwordPrefill);
            });
        }
      })
      .catch(() => setProvider("unknown"));
  }, []);

  const signIn = async (email: string) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url("/auth/login"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        goTo("/");
        return;
      }
      const body = await res.json().catch(() => ({}));
      setError(body.error || "Sign-in failed.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8">
        <div className="text-center mb-8">
          <Building2 className="h-14 w-14 text-blue-600 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900">SecureBank</h1>
          <p className="text-gray-500 mt-2">Enterprise Banking Platform</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-6">
            <p className="text-red-600 text-sm text-center">{decodeURIComponent(error)}</p>
          </div>
        )}

        {provider === "none" ? (
          <div>
            <p className="text-sm text-gray-600 mb-3">
              Demo mode — choose a user, then sign in.
            </p>

            <div className="space-y-2 max-h-64 overflow-y-auto mb-4">
              {users.map((u) => (
                <button
                  key={u.email}
                  disabled={busy}
                  onClick={() => setSelected(u.email)}
                  className={`w-full text-left border rounded-md px-3 py-2 transition
                    ${selected === u.email ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:bg-gray-50"}
                    disabled:opacity-50`}
                >
                  <div className="font-medium text-sm text-gray-900">{u.name}</div>
                  <div className="text-xs text-gray-500">
                    {u.email}{u.role ? ` · ${u.role}` : ""}
                  </div>
                </button>
              ))}
              {users.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-4">Loading users…</p>
              )}
            </div>

            {passwordRequired && (
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && selected) signIn(selected); }}
                placeholder="Password"
                autoComplete="current-password"
                className="w-full border border-gray-300 rounded-md px-3 py-2 mb-3 text-sm"
              />
            )}

            <Button
              className="w-full bg-blue-500 hover:bg-blue-600 text-white py-3 text-base"
              disabled={busy || !selected}
              onClick={() => selected && signIn(selected)}
            >
              {busy ? "Signing in…" : selected ? `Sign in as ${selected.split("@")[0]}` : "Select a user"}
            </Button>
          </div>
        ) : (
          <Button
            className="w-full bg-blue-500 hover:bg-blue-600 text-white py-3 text-base"
            onClick={() => { goTo("/auth/login"); }}
          >
            {buttonLabel}
          </Button>
        )}

        <p className="text-center text-xs text-gray-400 mt-6">
          Powered by REVA TES · Cedar Authorization
        </p>

        {/* BUILD STAMP. Deliberately on the SIGN-IN screen, because that is the
            one page reachable without credentials — so "did my change deploy?"
            can be answered from a browser, or by curl-ing the page, without
            logging in or SSHing to the box.

            Baked in at build time by vite.config.ts from values run.sh reads
            out of git. A "-dirty" suffix means the build came from uncommitted
            changes and exists only on that machine. */}
        <p
          className="text-center text-[11px] text-gray-400 mt-1 font-mono"
          data-testid="build-stamp"
        >
          build {import.meta.env.VITE_BUILD_SHA}
          {import.meta.env.VITE_BUILD_DATE ? ` · ${import.meta.env.VITE_BUILD_DATE}` : ""}
        </p>
      </div>
    </div>
  );
}
