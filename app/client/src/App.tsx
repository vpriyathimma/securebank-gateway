import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Route, Router, Switch } from 'wouter';
import { queryClient } from '@/lib/queryClient';
import { AuthProvider } from '@/hooks/use-auth';
import { Layout } from '@/components/ui/layout';
import { Dashboard } from '@/pages/dashboard';
import { Accounts } from '@/pages/accounts';
import { Transactions } from '@/pages/transactions';
import { Loans } from '@/pages/loans';
import { Users } from '@/pages/users';
import AuditLogsPage from '@/pages/audit-logs';
import { NotFound } from '@/pages/not-found';

// Public base path, no trailing slash: "" at the root, "/securebank" behind the
// demo box's nginx. wouter matches AND generates paths relative to this, so
// without it every Link and setLocation emits a root-relative URL — clicking
// Dashboard went to /dashboard rather than /securebank/dashboard, which nginx
// hands to a different app and renders as this app's own 404.
//
// Routes below stay written as "/dashboard": the base is applied by the Router,
// not repeated in every path.
const ROUTER_BASE = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Layout>
          <Router base={ROUTER_BASE}>
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/dashboard" component={Dashboard} />
            <Route path="/accounts" component={Accounts} />
            <Route path="/transactions" component={Transactions} />
            <Route path="/loans" component={Loans} />
            <Route path="/users" component={Users} />
            <Route path="/audit-logs" component={AuditLogsPage} />
            <Route component={NotFound} />
          </Switch>
          </Router>
        </Layout>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;