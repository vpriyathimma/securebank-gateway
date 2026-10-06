import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Account, User } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface EditAccountModalProps {
  account: (Account & { user: User }) | null;
  isOpen: boolean;
  onClose: () => void;
}

export function EditAccountModal({ account, isOpen, onClose }: EditAccountModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState({
    balance: account?.balance || "0.00",
    status: account?.status || "active",
  });

  // Reset form when account changes
  useEffect(() => {
    if (account) {
      setFormData({
        balance: account.balance,
        status: account.status,
      });
    }
  }, [account]);

  const updateAccountMutation = useMutation({
    mutationFn: async (data: { balance: string; status: string }) => {
      if (!account) throw new Error("No account selected");
      return apiRequest(`/api/accounts/${account.id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      toast({
        title: "Success",
        description: "Account updated successfully",
      });
      onClose();
    },
    onError: (error: Error) => {
      console.error("Update account error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to update account",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateAccountMutation.mutate(formData);
  };

  const handleClose = () => {
    if (account) {
      setFormData({
        balance: account.balance,
        status: account.status,
      });
    }
    onClose();
  };

  if (!account) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Account Details</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="account-holder">Account Holder</Label>
            <Input
              id="account-holder"
              value={account.user?.name || 'Unknown'}
              disabled
              className="bg-gray-50"
            />
          </div>
          
          <div>
            <Label htmlFor="account-number">Account Number</Label>
            <Input
              id="account-number"
              value={account.accountNumber}
              disabled
              className="bg-gray-50"
            />
          </div>

          <div>
            <Label htmlFor="balance">Account Balance</Label>
            <Input
              id="balance"
              type="number"
              step="0.01"
              value={formData.balance}
              onChange={(e) => setFormData(prev => ({ ...prev, balance: e.target.value }))}
              required
            />
          </div>

          <div>
            <Label htmlFor="status">Account Status</Label>
            <Select
              value={formData.status}
              onValueChange={(value) => setFormData(prev => ({ ...prev, status: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="frozen">Frozen</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-bank-blue hover:bg-blue-700"
              disabled={updateAccountMutation.isPending}
            >
              {updateAccountMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
