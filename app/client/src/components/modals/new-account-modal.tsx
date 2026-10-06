import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { insertAccountSchema } from '@shared/schema';

const newAccountSchema = insertAccountSchema.extend({
  initialBalance: z.string().min(1, "Initial balance is required")
});

type NewAccountFormData = z.infer<typeof newAccountSchema>;

interface NewAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NewAccountModal({ isOpen, onClose }: NewAccountModalProps) {
  const { toast } = useToast();

  // Fetch users for the dropdown
  const { data: users = [] } = useQuery<any[]>({
    queryKey: ['/api/users'],
    enabled: isOpen
  });

  const form = useForm<NewAccountFormData>({
    resolver: zodResolver(newAccountSchema),
    defaultValues: {
      accountNumber: '',
      userId: '',
      accountType: 'checking',
      initialBalance: '0.00',
      status: 'active'
    }
  });

  const createAccountMutation = useMutation({
    mutationFn: (data: NewAccountFormData) => {
      // Convert initialBalance to balance
      const { initialBalance, ...accountData } = data;
      return apiRequest('/api/accounts', {
        method: 'POST',
        body: JSON.stringify({
          ...accountData,
          balance: initialBalance
        })
      });
    },
    onSuccess: () => {
      toast({
        title: "Account Created",
        description: "The new account has been created successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      form.reset();
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Creation Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  const onSubmit = (data: NewAccountFormData) => {
    createAccountMutation.mutate(data);
  };

  const handleClose = () => {
    form.reset();
    onClose();
  };

  // Generate account number suggestion
  const generateAccountNumber = () => {
    const prefix = form.watch('accountType') === 'savings' ? '2' : '1';
    const randomSuffix = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
    return `${prefix}001${randomSuffix.slice(0, 6)}`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Account</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Account Holder Selection */}
            <FormField
              control={form.control}
              name="userId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Account Holder</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select account holder" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {users
                        .filter((user: any) => user.role === 'Account Holder')
                        .map((user: any) => (
                          <SelectItem key={user.id} value={user.id}>
                            {user.name} ({user.email})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Account Type */}
            <FormField
              control={form.control}
              name="accountType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Account Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="checking">Checking</SelectItem>
                      <SelectItem value="savings">Savings</SelectItem>
                      <SelectItem value="business">Business</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Account Number */}
            <FormField
              control={form.control}
              name="accountNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Account Number</FormLabel>
                  <div className="flex space-x-2">
                    <FormControl>
                      <Input 
                        {...field} 
                        placeholder="Enter account number"
                        className="flex-1"
                      />
                    </FormControl>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const generated = generateAccountNumber();
                        form.setValue('accountNumber', generated);
                      }}
                    >
                      Generate
                    </Button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Initial Balance */}
            <FormField
              control={form.control}
              name="initialBalance"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Initial Balance</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Account Status */}
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="frozen">Frozen</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Actions */}
            <div className="flex justify-end space-x-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={createAccountMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createAccountMutation.isPending}
              >
                {createAccountMutation.isPending ? 'Creating...' : 'Create Account'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}