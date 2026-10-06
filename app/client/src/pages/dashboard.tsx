import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, DollarSign, Users, CreditCard, FileText } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { apiRequest } from '@/lib/queryClient';

interface DashboardStats {
  totalBalance?: number;
  totalLoans?: number;
  accountsCount?: number;
  loansCount?: number;
  totalCustomers?: number;
  recentTransactions?: Array<{
    id: string;
    type: string;
    amount: string;
    description: string;
    status: string;
    createdAt: string;
  }>;
}

export function Dashboard() {
  const { user } = useAuth();
  const { data: stats, isLoading, error } = useQuery<DashboardStats>({
    queryKey: ['/api/dashboard/stats'],
    queryFn: () => apiRequest('/api/dashboard/stats'),
    enabled: !!user, // Only run query when user is logged in
  });

  // Debug logging
  console.log('Dashboard - User:', user);
  console.log('Dashboard - Stats:', stats);
  console.log('Dashboard - Loading:', isLoading);
  console.log('Dashboard - Error:', error);
  
  if (error) {
    console.error('Dashboard API Error Details:', error);
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white p-6 rounded-lg shadow-sm border animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
              <div className="h-8 bg-gray-200 rounded w-1/2"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">Error loading dashboard data. Please try logging in again.</p>
          <p className="text-sm text-red-600 mt-1">Error: {error?.message || 'Unknown error'}</p>
        </div>
      </div>
    );
  }

  const formatCurrency = (amount: number) => 
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <div className="text-sm text-gray-500">
          Welcome back, {user?.name}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {user?.role === 'Account Holder' ? (
          <>
            <StatsCard
              title="Total Balance"
              value={formatCurrency(stats?.totalBalance || 0)}
              icon={DollarSign}
              trend="up"
              trendValue="2.5%"
              color="green"
            />
            <StatsCard
              title="Active Accounts"
              value={stats?.accountsCount || 0}
              icon={CreditCard}
              color="blue"
            />
            <StatsCard
              title="Active Loans"
              value={stats?.loansCount || 0}
              icon={FileText}
              color="orange"
            />
            <StatsCard
              title="Loan Balance"
              value={formatCurrency(stats?.totalLoans || 0)}
              icon={TrendingDown}
              color="red"
            />
          </>
        ) : (
          <>
            <StatsCard
              title="Total Customers"
              value={stats?.totalCustomers || 0}
              icon={Users}
              trend="up"
              trendValue="12"
              color="blue"
            />
            <StatsCard
              title="Total Deposits"
              value={formatCurrency(stats?.totalBalance || 0)}
              icon={DollarSign}
              trend="up"
              trendValue="8.2%"
              color="green"
            />
            <StatsCard
              title="Total Accounts"
              value={stats?.accountsCount || 0}
              icon={CreditCard}
              color="purple"
            />
            <StatsCard
              title="Active Loans"
              value={formatCurrency(stats?.totalLoans || 0)}
              icon={FileText}
              trend="down"
              trendValue="3.1%"
              color="orange"
            />
          </>
        )}
      </div>

      {/* Recent Transactions */}
      <div className="bg-white rounded-lg shadow-sm border">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Recent Transactions</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Description
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Amount
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {stats?.recentTransactions?.map((transaction: any, index: number) => (
                <tr key={index} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      {transaction.type === 'deposit' && (
                        <TrendingUp className="h-4 w-4 text-green-500 mr-2" />
                      )}
                      {transaction.type === 'withdrawal' && (
                        <TrendingDown className="h-4 w-4 text-red-500 mr-2" />
                      )}
                      {transaction.type === 'transfer' && (
                        <DollarSign className="h-4 w-4 text-blue-500 mr-2" />
                      )}
                      <span className="text-sm font-medium text-gray-900 capitalize">
                        {transaction.type}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-900">{transaction.description}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className={`text-sm font-medium ${
                      transaction.type === 'deposit' ? 'text-green-600' : 
                      transaction.type === 'withdrawal' ? 'text-red-600' : 'text-gray-900'
                    }`}>
                      {transaction.type === 'deposit' ? '+' : transaction.type === 'withdrawal' ? '-' : ''}
                      {formatCurrency(parseFloat(transaction.amount))}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(transaction.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      transaction.status === 'completed' 
                        ? 'bg-green-100 text-green-800'
                        : transaction.status === 'pending'
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {transaction.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: React.ComponentType<any>;
  trend?: 'up' | 'down';
  trendValue?: string;
  color: 'blue' | 'green' | 'red' | 'orange' | 'purple';
}

function StatsCard({ title, value, icon: Icon, trend, trendValue, color }: StatsCardProps) {
  const colorClasses = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    red: 'bg-red-500',
    orange: 'bg-orange-500',
    purple: 'bg-purple-500',
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          {trend && trendValue && (
            <div className="flex items-center mt-1">
              {trend === 'up' ? (
                <TrendingUp className="h-4 w-4 text-green-500 mr-1" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-500 mr-1" />
              )}
              <span className={`text-sm ${trend === 'up' ? 'text-green-600' : 'text-red-600'}`}>
                {trendValue}
              </span>
            </div>
          )}
        </div>
        <div className={`p-3 rounded-full ${colorClasses[color]}`}>
          <Icon className="h-6 w-6 text-white" />
        </div>
      </div>
    </div>
  );
}