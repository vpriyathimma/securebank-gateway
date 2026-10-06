import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

interface LoanAcceptanceModalProps {
  loan: any;
  isOpen: boolean;
  onClose: () => void;
}

export function LoanAcceptanceModal({
  loan,
  isOpen,
  onClose,
}: LoanAcceptanceModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [hasAcceptLoanPermission, setHasAcceptLoanPermission] =
    useState<boolean>(false);
  const [hasDeclineLoanPermission, setHasDeclineLoanPermission] =
    useState<boolean>(false);

  const acceptMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/api/loans/${loan.id}/accept`, {
        method: "PATCH",
      }),
    onSuccess: () => {
      toast({
        title: "Loan Accepted",
        description:
          "You have accepted the loan offer. It will now be reviewed for final approval by bank staff.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/loans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const declineMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/api/loans/${loan.id}/decline`, {
        method: "PATCH",
      }),
    onSuccess: () => {
      toast({
        title: "Loan Declined",
        description: "You have declined the loan offer.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/loans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

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
    checkAcceptLoanPermission();
    checkDeclineLoanPermission();
  }, []);

  if (!loan) return null;

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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-green-800">
            🎉 Loan Offer for You!
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Loan Offer Header */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold text-green-800">
                Congratulations! You've been pre-qualified for a loan.
              </h3>
              <Badge variant="outline" className={getLoanTypeColor(loan.type)}>
                {loan.type} loan
              </Badge>
            </div>
            <p className="text-green-700 text-sm">
              Our bank staff has reviewed your profile and prepared this loan
              offer for you. Please review the terms below and let us know if
              you'd like to proceed.
            </p>
          </div>

          {/* Loan Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Loan Amount
                </label>
                <div className="text-2xl font-bold text-gray-900">
                  {formatCurrency(loan.amount)}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Interest Rate
                </label>
                <div className="text-xl font-semibold text-blue-600">
                  {loan.interestRate}% APR
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Loan Term
                </label>
                <div className="text-lg font-medium text-gray-900">
                  {loan.termMonths} months ({Math.round(loan.termMonths / 12)}{" "}
                  years)
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Monthly Payment
                </label>
                <div className="text-2xl font-bold text-green-600">
                  {formatCurrency(loan.monthlyPayment)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Principal & Interest
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Total Amount
                </label>
                <div className="text-lg font-medium text-gray-900">
                  {formatCurrency(
                    (parseFloat(loan.monthlyPayment) * loan.termMonths).toFixed(
                      2
                    )
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Over {loan.termMonths} months
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Total Interest
                </label>
                <div className="text-lg font-medium text-gray-900">
                  {formatCurrency(
                    (
                      parseFloat(loan.monthlyPayment) * loan.termMonths -
                      parseFloat(loan.amount)
                    ).toFixed(2)
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Additional Notes */}
          {loan.notes && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="font-medium text-blue-900 mb-2">
                Additional Information
              </h4>
              <p className="text-blue-800 text-sm">{loan.notes}</p>
            </div>
          )}

          {/* Important Information */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <h4 className="font-medium text-yellow-800 mb-2">
              Important Information
            </h4>
            <ul className="text-yellow-700 text-sm space-y-1">
              <li>
                • This offer is valid for 30 days from the date of this proposal
              </li>
              <li>• Accepting this offer does not guarantee final approval</li>
              <li>
                • Final approval is subject to additional verification by our
                lending team
              </li>
              <li>• Terms and conditions may apply</li>
            </ul>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3 pt-4 border-t">
            {hasDeclineLoanPermission && (
              <Button
                variant="outline"
                onClick={() => declineMutation.mutate()}
                disabled={acceptMutation.isPending || declineMutation.isPending}
                className="px-6"
              >
                {declineMutation.isPending ? "Declining..." : "Decline Offer"}
              </Button>
            )}
            {hasAcceptLoanPermission && (
              <Button
                onClick={() => acceptMutation.mutate()}
                disabled={acceptMutation.isPending || declineMutation.isPending}
                className="px-6 bg-green-600 hover:bg-green-700"
              >
                {acceptMutation.isPending ? "Accepting..." : "Accept Offer"}
              </Button>
            )}
            {!hasAcceptLoanPermission && !hasDeclineLoanPermission && (
              <div className="text-center p-4 bg-gray-50 rounded-lg">
                <p className="text-gray-600">
                  No actions available for this loan offer.
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
