import React, { createContext, useContext, useEffect, useState } from "react";
import { url, goTo } from "@/lib/base-path";

interface AuthUser {
  sub: string;
  email: string;
  name: string;
  role: string | null;
  clearanceLevel: number | null;
  branchId: string | null;
  department: string | null;
  agentId: string | null;
  accessGranted: boolean;
  enriched: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkAuth = () => {
      fetch(url("/api/auth/me"), { credentials: "include" })
        .then((res) => {
          if (!res.ok) return null;
          return res.json();
        })
        .then((data) => {
          setUser(data);
          setIsLoading(false);
        })
        .catch(() => {
          setUser(null);
          setIsLoading(false);
        });
    };

    // If coming from Okta callback, wait briefly for session to settle
    const params = new URLSearchParams(window.location.search);
    if (params.get("login") === "1") {
      window.history.replaceState({}, "", "/");
      setTimeout(checkAuth, 500);
    } else {
      checkAuth();
    }
  }, []);

  const logout = () => {
    goTo("/auth/logout");
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
