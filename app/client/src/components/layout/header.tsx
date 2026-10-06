import { User } from "@shared/schema";
import { Building2, LogOut, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface HeaderProps {
  currentUser: User;
  allUsers: User[];
  onUserSwitch: (user: User) => void;
  onLogout: () => void;
}

export function Header({ currentUser, allUsers, onUserSwitch, onLogout }: HeaderProps) {
  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  };

  const getUserAvatarColor = (userId: string) => {
    const colors = {
      'user-1': 'bg-blue-500',
      'user-2': 'bg-green-500',
      'user-3': 'bg-bank-blue',
      'user-4': 'bg-purple-500',
    };
    return colors[userId as keyof typeof colors] || 'bg-gray-500';
  };

  return (
    <header className="bg-white shadow-sm border-b border-gray-200">
      <div className="px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Building2 className="text-bank-blue text-2xl" />
              <h1 className="text-2xl font-bold text-bank-blue">SecureBank</h1>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            {/* User Switcher Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center space-x-3 hover:bg-gray-50 rounded-lg p-2 transition-colors">
                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-900">{currentUser.name}</p>
                    <p className="text-xs text-gray-500">{currentUser.role}</p>
                  </div>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${getUserAvatarColor(currentUser.id)}`}>
                    <span className="text-white text-sm font-medium">
                      {getInitials(currentUser.name)}
                    </span>
                  </div>
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {allUsers?.map((user) => (
                  <DropdownMenuItem
                    key={user.id}
                    onClick={() => onUserSwitch(user)}
                    className={`flex items-center space-x-3 p-3 ${
                      user.id === currentUser.id ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${getUserAvatarColor(user.id)}`}>
                      <span className="text-white text-sm font-medium">
                        {getInitials(user.name)}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{user.name}</p>
                      <p className="text-xs text-gray-500">{user.role}</p>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            
            <button 
              onClick={onLogout}
              className="text-gray-500 hover:text-gray-700"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
