import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  CreditCard,
  Plus,
  Eye,
  Edit,
  Trash2,
  CheckCircle,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AccountDetailsModal } from "@/components/AccountDetailsModal";
import { EditAccountModal } from "@/components/modals/edit-account-modal";
import { EditFullAccountModal } from "@/components/modals/edit-full-account-modal";
import { NewAccountModal } from "@/components/modals/new-account-modal";
import { AccountApprovalModal } from "@/components/modals/account-approval-modal";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

export function Accounts() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedAccount, setSelectedAccount] = useState<any>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isFullEditOpen, setIsFullEditOpen] = useState(false);
  const [isNewAccountOpen, setIsNewAccountOpen] = useState(false);
  const [isApprovalOpen, setIsApprovalOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<any>(null);
  const [fullEditAccount, setFullEditAccount] = useState<any>(null);
  const [hasDeletePermission, setHasDeletePermission] =
    useState<boolean>(false);
  const [hasEditAccountPermission, setHasEditAccountPermission] =
    useState<boolean>(false);
  const [hasApproveAccountPermission, setHasApproveAccountPermission] =
    useState<boolean>(false);
  const [viewPermissions, setViewPermissions] = useState<
    Record<string, boolean>
  >({});

  const { data: accounts = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/accounts"],
  });

  // Function to check delete permission (user-based, not account-specific)
  const checkDeletePermission = async () => {
    try {
      const response = await apiRequest("/api/accounts/delete-with-auth", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const hasPermission =
        response && response.length > 0 && response[0].decision;
      setHasDeletePermission(hasPermission);
      return hasPermission;
    } catch (error) {
      console.error("Error checking delete permission:", error);
      setHasDeletePermission(false);
      return false;
    }
  };

  // Function to check Edit Account permission (user-based, not account-specific)
  const checkEditAccountPermission = async () => {
    try {
      const response = await apiRequest(
        "/api/accounts/update-details-with-auth",
        {
          method: "POST",
          body: JSON.stringify({}),
        }
      );

      const hasPermission =
        response && response.length > 0 && response[0].decision;
      setHasEditAccountPermission(hasPermission);
      return hasPermission;
    } catch (error) {
      console.error("Error checking Edit Account permission:", error);
      setHasEditAccountPermission(false);
      return false;
    }
  };

  // Function to check Approve Account Changes permission (user-based, not account-specific)
  const checkApproveAccountPermission = async () => {
    try {
      const response = await apiRequest(
        "/api/accounts/approve-changes-with-auth",
        {
          method: "POST",
          body: JSON.stringify({}),
        }
      );

      const hasPermission =
        response && response.length > 0 && response[0].decision;
      setHasApproveAccountPermission(hasPermission);
      return hasPermission;
    } catch (error) {
      console.error(
        "Error checking Approve Account Changes permission:",
        error
      );
      setHasApproveAccountPermission(false);
      return false;
    }
  };

  // Function to check View Account Details permission for all accounts
  const checkViewPermissions = async () => {
    if (!accounts || accounts.length === 0) {
      return;
    }

    try {
      const response = await apiRequest("/api/account/view-with-auth", {
        method: "POST",
        body: JSON.stringify({}),
      });

      if (response && Array.isArray(response)) {
        // Create a map of account ID to permission
        const permissionMap: Record<string, boolean> = {};

        response.forEach((item: { id: string; decision: boolean }) => {
          permissionMap[item.id] = item.decision;
        });

        setViewPermissions(permissionMap);
      } else {
        // If no response or invalid format, set all permissions to false
        const permissionMap: Record<string, boolean> = {};
        accounts.forEach((account: any) => {
          permissionMap[account.id] = false;
        });
        setViewPermissions(permissionMap);
      }
    } catch (error) {
      console.error("Error checking View Account Details permissions:", error);
      // On error, set all permissions to false
      const permissionMap: Record<string, boolean> = {};
      accounts.forEach((account: any) => {
        permissionMap[account.id] = false;
      });
      setViewPermissions(permissionMap);
    }
  };

  // Check permissions once when component loads
  React.useEffect(() => {
    checkDeletePermission();
    checkEditAccountPermission();
    checkApproveAccountPermission();
  }, []);

  // Check view permissions when accounts data is loaded
  React.useEffect(() => {
    if (accounts && accounts.length > 0) {
      checkViewPermissions();
    }
  }, [accounts]);

  const deleteMutation = useMutation({
    mutationFn: (accountId: string) =>
      apiRequest(`/api/accounts/${accountId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({
        title: "Account Deleted",
        description: "The account has been deleted successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Delete Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>
        <div className="bg-white rounded-lg shadow-sm border animate-pulse">
          <div className="h-64 bg-gray-200 rounded-lg"></div>
        </div>
      </div>
    );
  }

  const formatCurrency = (amount: string) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(parseFloat(amount));

  const getAccountTypeColor = (type: string) => {
    switch (type) {
      case "checking":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "savings":
        return "bg-green-100 text-green-800 border-green-200";
      case "business":
        return "bg-purple-100 text-purple-800 border-purple-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-green-100 text-green-800";
      case "closed":
        return "bg-red-100 text-red-800";
      case "frozen":
        return "bg-yellow-100 text-yellow-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>
        {user?.role !== "Account Holder" && (
          <Button onClick={() => setIsNewAccountOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Account
          </Button>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm border">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {user?.role === "Account Holder" ? "My Accounts" : "All Accounts"}
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Account
                </th>
                {user?.role !== "Account Holder" && (
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Customer
                  </th>
                )}
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Balance
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Created
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {accounts?.map((account: any) => (
                <tr key={`account-${account.id}`} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <CreditCard className="h-5 w-5 text-gray-400 mr-3" />
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {account.accountNumber}
                        </div>
                        <div className="text-sm text-gray-500">
                          ID: {account.id.slice(0, 8)}...
                        </div>
                      </div>
                    </div>
                  </td>
                  {user?.role !== "Account Holder" && (
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {account.user?.name}
                      </div>
                      <div className="text-sm text-gray-500">
                        {account.user?.email}
                      </div>
                      {account.pendingAccountChanges && (
                        <Badge variant="outline" className="mt-1">
                          <Clock className="h-3 w-3 mr-1" />
                          Pending Approval
                        </Badge>
                      )}
                    </td>
                  )}
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Badge
                      variant="outline"
                      className={getAccountTypeColor(account.accountType)}
                    >
                      {account.accountType}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      {formatCurrency(account.balance)}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(
                        account.status
                      )}`}
                    >
                      {account.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(account.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex justify-end space-x-2">
                      {viewPermissions[account.id] && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedAccount(account);
                            setIsDetailsOpen(true);
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      )}
                      {hasEditAccountPermission && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setFullEditAccount(account);
                            setIsFullEditOpen(true);
                          }}
                          title="Edit Full Account Details"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      )}
                      {user?.role !== "Account Holder" && (
                        <>
                          {/* Approval button for Bank Managers when there are pending account changes */}
                          {account.pendingAccountChanges &&
                            user?.role === "Bank Manager" &&
                            hasApproveAccountPermission && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-blue-600 hover:text-blue-700"
                                onClick={() => {
                                  setSelectedAccount(account);
                                  setIsApprovalOpen(true);
                                }}
                                data-testid={`button-approve-account-changes-${account.id}`}
                              >
                                <CheckCircle className="h-4 w-4" />
                              </Button>
                            )}
                          {hasDeletePermission && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-600 hover:text-red-700"
                              onClick={() => {
                                if (
                                  confirm(
                                    "Are you sure you want to delete this account? This action cannot be undone."
                                  )
                                ) {
                                  deleteMutation.mutate(account.id);
                                }
                              }}
                              disabled={deleteMutation.isPending}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(!accounts || accounts.length === 0) && (
          <div className="text-center py-12">
            <CreditCard className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-sm font-medium text-gray-900 mb-2">
              No accounts found
            </h3>
            <p className="text-sm text-gray-500">
              {user?.role === "Account Holder"
                ? "You don't have any accounts yet."
                : "No accounts have been created yet."}
            </p>
            {user?.role !== "Account Holder" && (
              <Button
                className="mt-4"
                onClick={() => setIsNewAccountOpen(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Create First Account
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Account Details Dialog */}
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Account Details</DialogTitle>
          </DialogHeader>
          {selectedAccount && (
            <AccountDetailsModal
              account={selectedAccount}
              canEdit={hasEditAccountPermission}
              canDelete={hasDeletePermission}
              onEdit={() => {
                setIsDetailsOpen(false);
                setFullEditAccount(selectedAccount);
                setIsFullEditOpen(true);
              }}
              onDelete={() => {
                if (
                  confirm(
                    "Are you sure you want to delete this account? This action cannot be undone."
                  )
                ) {
                  deleteMutation.mutate(selectedAccount.id);
                  setIsDetailsOpen(false);
                }
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Account Dialog */}
      <EditAccountModal
        account={editAccount}
        isOpen={isEditOpen}
        onClose={() => {
          setIsEditOpen(false);
          setEditAccount(null);
        }}
      />

      {/* Edit Full Account Dialog */}
      <EditFullAccountModal
        account={fullEditAccount}
        isOpen={isFullEditOpen}
        onClose={() => {
          setIsFullEditOpen(false);
          setFullEditAccount(null);
        }}
      />

      {/* New Account Dialog */}
      <NewAccountModal
        isOpen={isNewAccountOpen}
        onClose={() => setIsNewAccountOpen(false)}
      />

      {/* Account Approval Modal */}
      {selectedAccount && (
        <AccountApprovalModal
          account={selectedAccount}
          open={isApprovalOpen}
          onOpenChange={(open) => {
            setIsApprovalOpen(open);
            if (!open) setSelectedAccount(null);
          }}
        />
      )}
    </div>
  );
}
