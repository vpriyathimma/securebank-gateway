import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LoanWithUser } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getCurrentUser } from "@/lib/auth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface LoanDetailsModalProps {
  loan: LoanWithUser | null;
  isOpen: boolean;
  onClose: () => void;
}

export function LoanDetailsModal({ loan, isOpen, onClose }: LoanDetailsModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const currentUser = getCurrentUser();

  // Tell FinBot which loan is on screen, so "approve it" on turn 2 resolves to
  // something. The agent has no memory of earlier turns — it is invoked with a
  // single message — so without this the model re-lists loans and picks one,
  // which looks like it understood.
  //
  // FinBot lives outside React's tree (see index.html), hence the global rather
  // than a prop. Cleared on close so a stale loan cannot follow the user to an
  // unrelated question.
  useEffect(() => {
    const set = (window as any).finbotSetContext;
    if (typeof set !== "function") return;
    set(isOpen && loan ? { label: "Loan", id: loan.id } : null);
    return () => set(null);
  }, [isOpen, loan?.id]);

  const updateLoanMutation = useMutation({
    mutationFn: async (data: { status: string; approvedBy?: string }) => {
      if (!loan) throw new Error("No loan selected");
      return apiRequest("PATCH", `/api/loans/${loan.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/loans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({
        title: "Success",
        description: "Loan status updated successfully",
      });
      onClose();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update loan status",
        variant: "destructive",
      });
    },
  });

  const handleApprove = () => {
    updateLoanMutation.mutate({
      status: "approved",
      approvedBy: currentUser?.id,
    });
  };

  const handleReject = () => {
    updateLoanMutation.mutate({
      status: "rejected",
      approvedBy: currentUser?.id,
    });
  };

  if (!loan) return null;

  const formatCurrency = (amount: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(parseFloat(amount));
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved':
        return 'bg-green-100 text-green-800';
      case 'rejected':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-amber-100 text-amber-800';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Loan Details - {loan.loanNumber}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-500">Applicant</label>
              <p className="text-gray-900">{loan.user.name}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Email</label>
              <p className="text-gray-900">{loan.user.email}</p>
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-500">Loan Type</label>
              <p className="text-gray-900 capitalize">{loan.type}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Amount</label>
              <p className="text-gray-900 font-semibold">{formatCurrency(loan.amount)}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-500">Term</label>
              <p className="text-gray-900">{loan.term} Years</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Status</label>
              <Badge className={getStatusColor(loan.status)}>
                {loan.status.charAt(0).toUpperCase() + loan.status.slice(1)}
              </Badge>
            </div>
          </div>

          {loan.purpose && (
            <div>
              <label className="text-sm font-medium text-gray-500">Purpose</label>
              <p className="text-gray-900">{loan.purpose}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-500">Date Applied</label>
              <p className="text-gray-900">
                {new Date(loan.createdAt!).toLocaleDateString()}
              </p>
            </div>
            {loan.approvedAt && (
              <div>
                <label className="text-sm font-medium text-gray-500">Date Approved</label>
                <p className="text-gray-900">
                  {new Date(loan.approvedAt).toLocaleDateString()}
                </p>
              </div>
            )}
          </div>

          {loan.approver && (
            <div>
              <label className="text-sm font-medium text-gray-500">Approved By</label>
              <p className="text-gray-900">{loan.approver.name}</p>
            </div>
          )}

          {loan.status === 'pending' && currentUser && 
           (currentUser.role === 'Bank Manager' || currentUser.role === 'Bank Teller') && (
            <div className="flex justify-end space-x-2 pt-4">
              <Button
                onClick={handleReject}
                variant="destructive"
                disabled={updateLoanMutation.isPending}
              >
                Reject
              </Button>
              <Button
                onClick={handleApprove}
                className="bg-bank-green hover:bg-green-700"
                disabled={updateLoanMutation.isPending}
              >
                Approve
              </Button>
            </div>
          )}

          {loan.status !== 'pending' && (
            <div className="flex justify-end pt-4">
              <Button onClick={onClose} variant="outline">
                Close
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
