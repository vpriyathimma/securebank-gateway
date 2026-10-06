import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Header } from "./header";
import { Sidebar } from "./sidebar";
import { getCurrentUser, setCurrentUser, initializeAuth } from "@/lib/auth";
import { User } from "@shared/schema";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [currentUser, setCurrentUserState] = useState<User>(() => initializeAuth());
  const queryClient = useQueryClient();

  const { data: allUsers = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const handleUserSwitch = (user: User) => {
    setCurrentUser(user);
    setCurrentUserState(user);
    
    // Clear all cached data and refetch everything for the new user
    queryClient.clear();
    
    // Smoothly refetch queries without page reload for better UX
    queryClient.invalidateQueries();
    queryClient.refetchQueries();
  };

  const handleLogout = () => {
    // In a real app, this would clear auth tokens and redirect to login
    console.log("Logout clicked");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header 
        currentUser={currentUser} 
        allUsers={allUsers}
        onUserSwitch={handleUserSwitch}
        onLogout={handleLogout} 
      />
      <div className="flex h-[calc(100vh-80px)]">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
