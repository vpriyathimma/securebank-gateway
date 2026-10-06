import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowUpDown,
  Plus,
  Eye,
  Trash2,
  TrendingUp,
  TrendingDown,
  DollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TransferForm } from "@/components/TransferForm";
import { TransactionDetailsModal } from "@/components/TransactionDetailsModal";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

export function Transactions() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<any>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [hasTransferPermission, setHasTransferPermission] =
    useState<boolean>(false);

  const { data: transactions = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/transactions"],
  });

  const deleteMutation = useMutation({
    mutationFn: (transactionId: string) =>
      apiRequest(`/api/transactions/${transactionId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({
        title: "Transaction Deleted",
        description: "The transaction has been deleted successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
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

  // Function to check Transfer Funds permission (user-based)
  const checkTransferPermission = async () => {
    try {
      const response = await apiRequest("/api/transaction/transfer-with-auth", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const hasPermission =
        response && response.length > 0 && response[0].decision;
      setHasTransferPermission(hasPermission);
      return hasPermission;
    } catch (error) {
      console.error("Error checking Transfer Funds permission:", error);
      setHasTransferPermission(false);
      return false;
    }
  };

  // Check permission once when component loads
  React.useEffect(() => {
    checkTransferPermission();
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Transactions</h1>
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

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "deposit":
        return <TrendingUp className="h-4 w-4 text-green-500" />;
      case "withdrawal":
        return <TrendingDown className="h-4 w-4 text-red-500" />;
      case "transfer":
        return <ArrowUpDown className="h-4 w-4 text-blue-500" />;
      default:
        return <DollarSign className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-green-100 text-green-800";
      case "pending":
        return "bg-yellow-100 text-yellow-800";
      case "failed":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Transactions</h1>
        <div className="flex space-x-2">
          {hasTransferPermission && (
            <Dialog open={isTransferOpen} onOpenChange={setIsTransferOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <ArrowUpDown className="h-4 w-4 mr-2" />
                  Transfer Funds
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Transfer Funds</DialogTitle>
                </DialogHeader>
                <TransferForm onSuccess={() => setIsTransferOpen(false)} />
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {user?.role === "Account Holder"
              ? "My Transactions"
              : "All Transactions"}
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type & Description
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  From/To
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Amount
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date
                </th>
                {user?.role !== "Account Holder" && (
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Processed By
                  </th>
                )}
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {transactions.map((transaction: any, index: number) => (
                <tr
                  key={`transaction-${transaction.id}-${index}`}
                  className="hover:bg-gray-50"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center">
                      {getTypeIcon(transaction.type)}
                      <div className="ml-3">
                        <div className="text-sm font-medium text-gray-900 capitalize">
                          {transaction.type}
                        </div>
                        <div className="text-sm text-gray-500">
                          {transaction.description}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-900">
                      {transaction.type === "deposit" && "External → "}
                      {transaction.type === "withdrawal" && "→ External"}
                      {transaction.type === "transfer" && (
                        <>
                          {transaction.fromAccount?.accountNumber || "Unknown"}{" "}
                          → {transaction.toAccount?.accountNumber || "Unknown"}
                        </>
                      )}
                      {transaction.type === "payment" && (
                        <>
                          {transaction.fromAccount?.accountNumber || "Account"}{" "}
                          → Payment
                        </>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div
                      className={`text-sm font-medium ${
                        transaction.type === "deposit"
                          ? "text-green-600"
                          : transaction.type === "withdrawal"
                          ? "text-red-600"
                          : "text-gray-900"
                      }`}
                    >
                      {transaction.type === "deposit"
                        ? "+"
                        : transaction.type === "withdrawal"
                        ? "-"
                        : ""}
                      {formatCurrency(transaction.amount)}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(
                        transaction.status
                      )}`}
                    >
                      {transaction.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(transaction.createdAt).toLocaleDateString()}
                    <br />
                    {new Date(transaction.createdAt).toLocaleTimeString()}
                  </td>
                  {user?.role !== "Account Holder" && (
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {transaction.processedByUser?.name || "System"}
                    </td>
                  )}
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex justify-end space-x-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedTransaction(transaction);
                          setIsDetailsOpen(true);
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {user?.role !== "Account Holder" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => {
                            if (
                              confirm(
                                "Are you sure you want to delete this transaction? This action cannot be undone."
                              )
                            ) {
                              deleteMutation.mutate(transaction.id);
                            }
                          }}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {transactions.length === 0 && (
          <div className="text-center py-12">
            <ArrowUpDown className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-sm font-medium text-gray-900 mb-2">
              No transactions found
            </h3>
            <p className="text-sm text-gray-500">
              {user?.role === "Account Holder"
                ? "You don't have any transactions yet."
                : "No transactions have been processed yet."}
            </p>
          </div>
        )}
      </div>

      {/* Transaction Details Dialog */}
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Transaction Details</DialogTitle>
          </DialogHeader>
          {selectedTransaction && (
            <TransactionDetailsModal
              transaction={selectedTransaction}
              canEdit={user?.role !== "Account Holder"}
              canDelete={user?.role !== "Account Holder"}
              onEdit={() => {
                setIsDetailsOpen(false);
                // Handle edit functionality
              }}
              onDelete={() => {
                if (
                  confirm(
                    "Are you sure you want to delete this transaction? This action cannot be undone."
                  )
                ) {
                  deleteMutation.mutate(selectedTransaction.id);
                  setIsDetailsOpen(false);
                }
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
