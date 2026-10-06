import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { FileText, Plus, Eye, Edit, Trash2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { LoanApplicationForm } from "@/components/LoanApplicationForm";
import { StaffLoanApplicationForm } from "@/components/StaffLoanApplicationForm";
import { LoanApprovalForm } from "@/components/LoanApprovalForm";
import { LoanDetailsModal } from "@/components/LoanDetailsModal";
import { LoanEditForm } from "@/components/LoanEditForm";
import { LoanAcceptanceModal } from "@/components/LoanAcceptanceModal";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

export function Loans() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isApplyLoanOpen, setIsApplyLoanOpen] = useState(false);
  const [isNewLoanOpen, setIsNewLoanOpen] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState<any>(null);
  const [isApprovalOpen, setIsApprovalOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isAcceptanceOpen, setIsAcceptanceOpen] = useState(false);
  const [hasNewLoanPermission, setHasNewLoanPermission] =
    useState<boolean>(false);
  const [hasApplyLoanPermission, setHasApplyLoanPermission] =
    useState<boolean>(false);
  const [hasApproveLoanPermission, setHasApproveLoanPermission] =
    useState<boolean>(false);
  const [hasRejectLoanPermission, setHasRejectLoanPermission] =
    useState<boolean>(false);
  const [hasAcceptLoanPermission, setHasAcceptLoanPermission] =
    useState<boolean>(false);
  const [hasDeclineLoanPermission, setHasDeclineLoanPermission] =
    useState<boolean>(false);

  const { data: loans = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/loans"],
  });

  // Function to check New Loan permission (user-based, not loan-specific)
  const checkNewLoanPermission = async () => {
    try {
      const response = await apiRequest("/api/loans/offer-with-auth", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const hasPermission =
        response && response.length > 0 && response[0].decision;
      setHasNewLoanPermission(hasPermission);
      return hasPermission;
    } catch (error) {
      console.error("Error checking New Loan permission:", error);
      setHasNewLoanPermission(false);
      return false;
    }
  };

  // Function to check Apply for Loan permission (user-based, not loan-specific)
  const checkApplyLoanPermission = async () => {
    try {
      const response = await apiRequest("/api/loans/create-with-auth", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const hasPermission =
        response && response.length > 0 && response[0].decision;
      setHasApplyLoanPermission(hasPermission);
      return hasPermission;
    } catch (error) {
      console.error("Error checking Apply for Loan permission:", error);
      setHasApplyLoanPermission(false);
      return false;
    }
  };

  // Function to check Approve Loan permission (user-based, not loan-specific)
  const checkApproveLoanPermission = async () => {
    try {
      const response = await apiRequest("/api/loans/approve-with-auth", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const hasPermission =
        response && response.length > 0 && response[0].decision;
      setHasApproveLoanPermission(hasPermission);
      return hasPermission;
    } catch (error) {
      console.error("Error checking Approve Loan permission:", error);
      setHasApproveLoanPermission(false);
      return false;
    }
  };

  // Function to check Reject Loan permission (user-based, not loan-specific)
  const checkRejectLoanPermission = async () => {
    try {
      const response = await apiRequest("/api/loans/reject-with-auth", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const hasPermission =
        response && response.length > 0 && response[0].decision;
      setHasRejectLoanPermission(hasPermission);
      return hasPermission;
    } catch (error) {
      console.error("Error checking Reject Loan permission:", error);
      setHasRejectLoanPermission(false);
      return false;
    }
  };

  // Function to check Accept Loan permission (user-based, not loan-specific)
  const checkAcceptLoanPermission = async () => {
    try {
      const response = await apiRequest("/api/loans/accept-with-auth", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const hasPermission =
        response && response.length > 0 && response[0].decision;
      setHasAcceptLoanPermission(hasPermission);
      return hasPermission;
    } catch (error) {
      console.error("Error checking Accept Loan permission:", error);
      setHasAcceptLoanPermission(false);
      return false;
    }
  };

  // Function to check Decline Loan permission (user-based, not loan-specific)
  const checkDeclineLoanPermission = async () => {
    try {
      const response = await apiRequest("/api/loans/decline-with-auth", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const hasPermission =
        response && response.length > 0 && response[0].decision;
      setHasDeclineLoanPermission(hasPermission);
      return hasPermission;
    } catch (error) {
      console.error("Error checking Decline Loan permission:", error);
      setHasDeclineLoanPermission(false);
      return false;
    }
  };

  // Check permissions once when component loads
  React.useEffect(() => {
    checkNewLoanPermission();
    checkApplyLoanPermission();
    checkApproveLoanPermission();
    checkRejectLoanPermission();
    checkAcceptLoanPermission();
    checkDeclineLoanPermission();
  }, []);

  const deleteMutation = useMutation({
    mutationFn: (loanId: string) =>
      apiRequest(`/api/loans/${loanId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({
        title: "Loan Deleted",
        description: "The loan has been deleted successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/loans"] });
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
        <h1 className="text-2xl font-bold text-gray-900">Loans</h1>
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

  const getLoanTypeColor = (type: string) => {
    switch (type) {
      case "personal":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "mortgage":
        return "bg-green-100 text-green-800 border-green-200";
      case "business":
        return "bg-purple-100 text-purple-800 border-purple-200";
      case "auto":
        return "bg-orange-100 text-orange-800 border-orange-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-green-100 text-green-800";
      case "pending":
        return "bg-yellow-100 text-yellow-800";
      case "offered":
        return "bg-blue-100 text-blue-800";
      case "accepted":
        return "bg-indigo-100 text-indigo-800";
      case "approved":
        return "bg-green-100 text-green-800";
      case "rejected":
        return "bg-red-100 text-red-800";
      case "paid_off":
        return "bg-gray-100 text-gray-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Loans</h1>
        <div className="flex space-x-2">
          {hasApplyLoanPermission && (
            <Dialog open={isApplyLoanOpen} onOpenChange={setIsApplyLoanOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Apply for Loan
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Apply for Loan</DialogTitle>
                </DialogHeader>
                <LoanApplicationForm
                  onSuccess={() => setIsApplyLoanOpen(false)}
                />
              </DialogContent>
            </Dialog>
          )}

          {hasNewLoanPermission && (
            <Dialog open={isNewLoanOpen} onOpenChange={setIsNewLoanOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Plus className="h-4 w-4 mr-2" />
                  New Loan
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create New Loan</DialogTitle>
                </DialogHeader>
                <StaffLoanApplicationForm
                  onSuccess={() => setIsNewLoanOpen(false)}
                />
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {user?.role === "Account Holder" ? "My Loans" : "All Loans"}
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Loan Details
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
                  Amount
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Remaining
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Monthly Payment
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loans?.map((loan: any) => (
                <tr key={loan.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <FileText className="h-5 w-5 text-gray-400 mr-3" />
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {loan.interestRate}% APR
                        </div>
                        <div className="text-sm text-gray-500">
                          {loan.termMonths} months
                        </div>
                      </div>
                    </div>
                  </td>
                  {user?.role !== "Account Holder" && (
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {loan.user?.name}
                      </div>
                      <div className="text-sm text-gray-500">
                        {loan.user?.email}
                      </div>
                    </td>
                  )}
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Badge
                      variant="outline"
                      className={getLoanTypeColor(loan.type)}
                    >
                      {loan.type}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      {formatCurrency(loan.amount)}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      {formatCurrency(loan.remainingBalance)}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(
                        loan.status
                      )}`}
                    >
                      {loan.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      {formatCurrency(loan.monthlyPayment)}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex justify-end space-x-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedLoan(loan);
                          setIsDetailsOpen(true);
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>

                      {/* Account Holders can accept/decline offered loans */}
                      {user?.role === "Account Holder" &&
                        loan.status === "offered" && (
                          <>
                            {/* Accept/Decline button - show if either accept OR decline permission is true */}
                            {(hasAcceptLoanPermission ||
                              hasDeclineLoanPermission) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-blue-600 hover:text-blue-700"
                                onClick={() => {
                                  setSelectedLoan(loan);
                                  setIsAcceptanceOpen(true);
                                }}
                                title="Review and accept/decline loan offer"
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                            )}
                          </>
                        )}
                      {user?.role !== "Account Holder" &&
                        (loan.status === "pending" ||
                          loan.status === "accepted") && (
                          <>
                            {/* Approve button - show if either approve OR reject permission is true */}
                            {(hasApproveLoanPermission ||
                              hasRejectLoanPermission) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-green-600 hover:text-green-700"
                                onClick={() => {
                                  setSelectedLoan(loan);
                                  setIsApprovalOpen(true);
                                }}
                                title="Review and approve/reject loan"
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                            )}
                            {/* Reject button - show only if reject permission is true */}
                            {hasRejectLoanPermission && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-red-600 hover:text-red-700"
                                onClick={async () => {
                                  if (
                                    confirm(
                                      `Are you sure you want to reject the loan for ${loan.user?.name}?`
                                    )
                                  ) {
                                    try {
                                      await apiRequest(
                                        `/api/loans/${loan.id}/decision`,
                                        {
                                          method: "PATCH",
                                          body: JSON.stringify({
                                            decision: "rejected",
                                            notes: `Loan rejected by ${user?.name}`,
                                          }),
                                        }
                                      );
                                      queryClient.invalidateQueries({
                                        queryKey: ["/api/loans"],
                                      });
                                      toast({
                                        title: "Loan Rejected",
                                        description:
                                          "The loan has been rejected successfully.",
                                      });
                                    } catch (error: any) {
                                      toast({
                                        title: "Rejection Failed",
                                        description: error.message,
                                        variant: "destructive",
                                      });
                                    }
                                  }
                                }}
                                title="Quick reject loan"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            )}
                          </>
                        )}
                      {user?.role !== "Account Holder" && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedLoan(loan);
                              setIsEditOpen(true);
                            }}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          {user?.role === "Bank Manager" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-600 hover:text-red-700"
                              onClick={() => {
                                if (
                                  confirm(
                                    "Are you sure you want to delete this loan? This action cannot be undone."
                                  )
                                ) {
                                  deleteMutation.mutate(loan.id);
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

        {(!loans || loans.length === 0) && (
          <div className="text-center py-12">
            <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-sm font-medium text-gray-900 mb-2">
              No loans found
            </h3>
            <p className="text-sm text-gray-500">
              {user?.role === "Account Holder"
                ? "You don't have any loans yet."
                : "No loan applications have been submitted yet."}
            </p>
            <div className="flex justify-center space-x-2 mt-4">
              {hasApplyLoanPermission && (
                <Button onClick={() => setIsApplyLoanOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Apply for Your First Loan
                </Button>
              )}
              {hasNewLoanPermission && (
                <Button
                  variant="outline"
                  onClick={() => setIsNewLoanOpen(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create First Loan
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Loan Approval Dialog */}
      <Dialog open={isApprovalOpen} onOpenChange={setIsApprovalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Review Loan Application - {selectedLoan?.user?.name}
            </DialogTitle>
          </DialogHeader>
          {selectedLoan && (
            <LoanApprovalForm
              loan={selectedLoan}
              onSuccess={() => {
                setIsApprovalOpen(false);
                setSelectedLoan(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Loan Details Dialog */}
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Loan Details - {selectedLoan?.user?.name}</DialogTitle>
          </DialogHeader>
          {selectedLoan && (
            <LoanDetailsModal
              loan={selectedLoan}
              canEdit={user?.role !== "Account Holder"}
              canDelete={user?.role === "Bank Manager"}
              onEdit={() => {
                setIsDetailsOpen(false);
                setIsEditOpen(true);
              }}
              onDelete={() => {
                if (
                  confirm(
                    "Are you sure you want to delete this loan? This action cannot be undone."
                  )
                ) {
                  deleteMutation.mutate(selectedLoan.id);
                  setIsDetailsOpen(false);
                  setSelectedLoan(null);
                }
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Loan Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Loan - {selectedLoan?.user?.name}</DialogTitle>
          </DialogHeader>
          {selectedLoan && (
            <LoanEditForm
              loan={selectedLoan}
              onSuccess={() => {
                setIsEditOpen(false);
                setSelectedLoan(null);
              }}
              onCancel={() => {
                setIsEditOpen(false);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Loan Acceptance Modal (for Account Holders) */}
      {selectedLoan && (
        <LoanAcceptanceModal
          loan={selectedLoan}
          isOpen={isAcceptanceOpen}
          onClose={() => {
            setIsAcceptanceOpen(false);
            setSelectedLoan(null);
          }}
        />
      )}
    </div>
  );
}
