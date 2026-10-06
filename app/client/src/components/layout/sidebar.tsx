import { useLocation } from "wouter";
import { 
  BarChart3, 
  Banknote, 
  ArrowLeftRight, 
  Handshake, 
  Users 
} from "lucide-react";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const [location, setLocation] = useLocation();

  const navigation = [
    { name: "Dashboard", href: "/", icon: BarChart3 },
    { name: "Accounts", href: "/accounts", icon: Banknote },
    { name: "Transactions", href: "/transactions", icon: ArrowLeftRight },
    { name: "Loans", href: "/loans", icon: Handshake },
    { name: "Users", href: "/users", icon: Users },
  ];

  return (
    <aside className="w-64 bg-white shadow-sm border-r border-gray-200">
      <nav className="mt-6">
        <div className="px-4 mb-6">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Navigation
          </h3>
        </div>
        <div className="space-y-1 px-2">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            
            return (
              <a
                key={item.name}
                href={item.href}
                onClick={(e) => {
                  e.preventDefault();
                  setLocation(item.href);
                }}
                className={cn(
                  "flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors",
                  isActive
                    ? "text-bank-blue bg-blue-50"
                    : "text-gray-700 hover:bg-gray-50"
                )}
              >
                <Icon className="mr-3 w-5 h-5" />
                {item.name}
              </a>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}
