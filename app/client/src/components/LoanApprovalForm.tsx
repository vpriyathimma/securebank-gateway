import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Badge } from "./ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

const loanDecisionSchema = z.object({
  decision: z.enum(["approved", "rejected", "offered", "accepted", "declined"]),
  interestRate: z
    .string()
    .optional()
    .refine((val) => !val || (!isNaN(Number(val)) && Number(val) > 0), {
      message: "Interest rate must be a positive number",
    }),
  notes: z.string().optional(),
});

type LoanDecisionData = z.infer<typeof loanDecisionSchema>;

interface LoanApprovalFormProps {
  loan: any;
  onSuccess?: () => void;
}

export function LoanApprovalForm({ loan, onSuccess }: LoanApprovalFormProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [hasApproveLoanPermission, setHasApproveLoanPermission] =
    useState<boolean>(false);
  const [hasRejectLoanPermission, setHasRejectLoanPermission] =
    useState<boolean>(false);

  const form = useForm<LoanDecisionData>({
    resolver: zodResolver(loanDecisionSchema),
    defaultValues: {
      decision: undefined,
      interestRate: loan.interestRate || "",
      notes: "",
    },
  });

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

  // Check permissions once when component loads
  React.useEffect(() => {
    checkApproveLoanPermission();
    checkRejectLoanPermission();
  }, []);

  const decisionMutation = useMutation({
    mutationFn: (data: LoanDecisionData) =>
      apiRequest(`/api/loans/${loan.id}/decision`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: (data) => {
      toast({
        title: "Loan Decision Processed",
        description: data.message,
      });
      form.reset();
      queryClient.invalidateQueries({ queryKey: ["/api/loans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({
        title: "Decision Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Get the correct actions based on user role, loan status, and permissions
  const getAvailableActions = () => {
    if (!user) return [];

    if (user.role === "Bank Teller") {
      if (loan.status === "pending") {
        const actions = [];
        if (hasApproveLoanPermission) {
          actions.push({
            action: "approved",
            label: "Approve Loan",
            variant: "default" as const,
          });
        }
        actions.push({
          action: "offered",
          label: "Send Offer",
          variant: "outline" as const,
        });
        if (hasRejectLoanPermission) {
          actions.push({
            action: "rejected",
            label: "Reject Application",
            variant: "destructive" as const,
          });
        }
        return actions;
      }
      if (loan.status === "accepted") {
        const actions = [];
        if (hasApproveLoanPermission) {
          actions.push({
            action: "approved",
            label: "Approve Loan",
            variant: "default" as const,
          });
        }
        if (hasRejectLoanPermission) {
          actions.push({
            action: "rejected",
            label: "Reject Loan",
            variant: "destructive" as const,
          });
        }
        return actions;
      }
    }

    if (user.role === "Bank Manager") {
      if (loan.status === "pending") {
        const actions = [];
        if (hasApproveLoanPermission) {
          actions.push({
            action: "approved",
            label: "Approve Loan",
            variant: "default" as const,
          });
        }
        actions.push({
          action: "offered",
          label: "Send Offer",
          variant: "outline" as const,
        });
        if (hasRejectLoanPermission) {
          actions.push({
            action: "rejected",
            label: "Reject Application",
            variant: "destructive" as const,
          });
        }
        return actions;
      }
      if (loan.status === "accepted") {
        const actions = [];
        if (hasApproveLoanPermission) {
          actions.push({
            action: "approved",
            label: "Approve Loan",
            variant: "default" as const,
          });
        }
        if (hasRejectLoanPermission) {
          actions.push({
            action: "rejected",
            label: "Reject Loan",
            variant: "destructive" as const,
          });
        }
        return actions;
      }
    }

    if (user.role === "Account Holder" && loan.userId === user.id) {
      if (loan.status === "offered") {
        return [
          {
            action: "accepted",
            label: "Accept Offer",
            variant: "default" as const,
          },
          {
            action: "declined",
            label: "Decline Offer",
            variant: "destructive" as const,
          },
        ];
      }
    }

    return [];
  };

  const handleAction = (action: string) => {
    const data = {
      decision: action as any,
      interestRate: form.getValues("interestRate"),
      notes: form.getValues("notes"),
    };
    decisionMutation.mutate(data);
  };

  if (user?.role === "Account Holder") {
    return (
      <div className="text-center p-6 bg-gray-50 rounded-lg">
        <p className="text-gray-600">
          Only Bank staff can approve or reject loans.
        </p>
      </div>
    );
  }

  if (!["pending", "accepted"].includes(loan.status)) {
    return (
      <div className="text-center p-6 bg-gray-50 rounded-lg">
        <p className="text-gray-600">This loan has already been processed.</p>
        <Badge
          className={`mt-2 ${
            loan.status === "approved"
              ? "bg-green-100 text-green-800"
              : loan.status === "rejected"
              ? "bg-red-100 text-red-800"
              : "bg-gray-100 text-gray-800"
          }`}
        >
          {loan.status.toUpperCase()}
        </Badge>
      </div>
    );
  }

  const formatCurrency = (amount: string) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(parseFloat(amount));

  return (
    <div className="space-y-6">
      {/* Loan Details Summary */}
      <div
        className={`p-4 rounded-lg ${
          loan.status === "accepted" ? "bg-green-50" : "bg-blue-50"
        }`}
      >
        <h4
          className={`font-medium mb-3 ${
            loan.status === "accepted" ? "text-green-900" : "text-blue-900"
          }`}
        >
          {loan.status === "accepted"
            ? "Customer Accepted Loan Offer"
            : "Loan Application Details"}
        </h4>
        {loan.status === "accepted" && (
          <div className="mb-4 p-3 bg-green-100 border border-green-200 rounded-lg">
            <p className="text-green-800 text-sm font-medium">
              ✅ The customer has accepted this loan offer and is ready for
              final approval.
            </p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span
              className={`font-medium ${
                loan.status === "accepted" ? "text-green-700" : "text-blue-700"
              }`}
            >
              Applicant:
            </span>
            <p
              className={
                loan.status === "accepted" ? "text-green-800" : "text-blue-800"
              }
            >
              {loan.user?.name}
            </p>
          </div>
          <div>
            <span
              className={`font-medium ${
                loan.status === "accepted" ? "text-green-700" : "text-blue-700"
              }`}
            >
              Loan Type:
            </span>
            <p
              className={`capitalize ${
                loan.status === "accepted" ? "text-green-800" : "text-blue-800"
              }`}
            >
              {loan.type}
            </p>
          </div>
          <div>
            <span
              className={`font-medium ${
                loan.status === "accepted" ? "text-green-700" : "text-blue-700"
              }`}
            >
              Amount:
            </span>
            <p
              className={
                loan.status === "accepted" ? "text-green-800" : "text-blue-800"
              }
            >
              {formatCurrency(loan.amount)}
            </p>
          </div>
          <div>
            <span
              className={`font-medium ${
                loan.status === "accepted" ? "text-green-700" : "text-blue-700"
              }`}
            >
              Term:
            </span>
            <p
              className={
                loan.status === "accepted" ? "text-green-800" : "text-blue-800"
              }
            >
              {loan.termMonths} months
            </p>
          </div>
          <div className="col-span-2">
            <span
              className={`font-medium ${
                loan.status === "accepted" ? "text-green-700" : "text-blue-700"
              }`}
            >
              Current Monthly Payment:
            </span>
            <p
              className={
                loan.status === "accepted" ? "text-green-800" : "text-blue-800"
              }
            >
              {formatCurrency(loan.monthlyPayment)}
            </p>
          </div>
          {loan.notes && (
            <div className="col-span-2">
              <span
                className={`font-medium ${
                  loan.status === "accepted"
                    ? "text-green-700"
                    : "text-blue-700"
                }`}
              >
                Application Notes:
              </span>
              <p
                className={
                  loan.status === "accepted"
                    ? "text-green-800"
                    : "text-blue-800"
                }
              >
                {loan.notes}
              </p>
            </div>
          )}
        </div>
      </div>

      <form className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Interest Rate (%) - Optional for Approval
          </label>
          <Input
            type="number"
            step="0.01"
            {...form.register("interestRate")}
            placeholder={`Current: ${loan.interestRate}%`}
          />
          {form.formState.errors.interestRate && (
            <p className="text-red-500 text-sm mt-1">
              {form.formState.errors.interestRate.message}
            </p>
          )}
          <p className="text-sm text-gray-500 mt-1">
            Leave blank to keep current rate ({loan.interestRate}%). New rate
            will recalculate monthly payment.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Decision Notes (Optional)
          </label>
          <Textarea
            {...form.register("notes")}
            placeholder="Add any notes about your decision..."
            rows={3}
          />
        </div>

        <div className="flex space-x-3">
          {getAvailableActions().map((actionItem, index) => (
            <Button
              key={actionItem.action}
              type="button"
              onClick={() => handleAction(actionItem.action)}
              disabled={decisionMutation.isPending}
              variant={actionItem.variant}
              className={`flex-1 ${
                actionItem.variant === "destructive"
                  ? "text-red-600 border-red-600 hover:bg-red-50"
                  : actionItem.action === "approved" ||
                    actionItem.action === "accepted"
                  ? "bg-green-600 hover:bg-green-700"
                  : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {decisionMutation.isPending ? "Processing..." : actionItem.label}
            </Button>
          ))}
          {getAvailableActions().length === 0 && (
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-gray-600">
                No actions available for this loan status.
              </p>
            </div>
          )}
        </div>
      </form>

      <div className="bg-gray-50 p-3 rounded-lg">
        <h4 className="font-medium text-gray-900 mb-1">Decision Guidelines:</h4>
        <ul className="text-sm text-gray-700 space-y-1">
          <li>• Review applicant's credit history and financial standing</li>
          <li>• Consider loan amount relative to income and existing debt</li>
          <li>• Adjust interest rate based on risk assessment if approving</li>
          <li>• Document reasoning in notes for audit trail</li>
        </ul>
      </div>
    </div>
  );
}
