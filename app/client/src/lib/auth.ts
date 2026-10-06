import type { User } from '../../../shared/schema';

export interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, role: string) => Promise<void>;
  logout: () => Promise<void>;
  switchUser: (email: string, role: string) => Promise<void>;
}

// Sample users for easy login during development
export const sampleUsers = [
  { email: 'john.smith@email.com', role: 'Account Holder', name: 'John Smith' },
  { email: 'sarah.johnson@email.com', role: 'Bank Teller', name: 'Sarah Johnson' },
  { email: 'mike.wilson@email.com', role: 'Bank Manager', name: 'Mike Wilson' },
  { email: 'emma.davis@email.com', role: 'Account Holder', name: 'Emma Davis' },
  { email: 'david.brown@email.com', role: 'Account Holder', name: 'David Brown' },
];

export const roleColors = {
  'Account Holder': 'bg-blue-100 text-blue-800 border-blue-200',
  'Bank Teller': 'bg-green-100 text-green-800 border-green-200',
  'Bank Manager': 'bg-purple-100 text-purple-800 border-purple-200',
};