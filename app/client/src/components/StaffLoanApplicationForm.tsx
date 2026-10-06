import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';

const staffLoanSchema = z.object({
  userId: z.string().min(1, "Please select an account holder"),
  type: z.string().min(1, "Please select a loan type"),
  amount: z.string().min(1, "Please enter the loan amount").refine(
    (val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0,
    "Amount must be a positive number"
  ),
  interestRate: z.string().min(1, "Please enter the interest rate").refine(
    (val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0,
    "Interest rate must be a positive number"
  ),
  termMonths: z.string().min(1, "Please enter the loan term").refine(
    (val) => !isNaN(parseInt(val)) && parseInt(val) > 0,
    "Term must be a positive number"
  ),
  notes: z.string().optional(),
  status: z.enum(['pending', 'offered', 'approved', 'rejected']).default('offered'),
});

type StaffLoanFormData = z.infer<typeof staffLoanSchema>;

interface StaffLoanApplicationFormProps {
  onSuccess: () => void;
}

export function StaffLoanApplicationForm({ onSuccess }: StaffLoanApplicationFormProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  // Fetch account holders for selection
  const { data: users = [] } = useQuery<any[]>({
    queryKey: ['/api/users'],
  });

  const form = useForm<StaffLoanFormData>({
    resolver: zodResolver(staffLoanSchema),
    defaultValues: {
      userId: '',
      type: '',
      amount: '',
      interestRate: '5.5',
      termMonths: '60',
      notes: '',
      status: 'offered',
    },
  });

  const createLoanMutation = useMutation({
    mutationFn: (data: StaffLoanFormData) => {
      // Calculate monthly payment using standard loan formula
      const principal = parseFloat(data.amount);
      const monthlyRate = parseFloat(data.interestRate) / 100 / 12;
      const numPayments = parseInt(data.termMonths);
      
      let monthlyPayment: number;
      if (monthlyRate === 0) {
        monthlyPayment = principal / numPayments;
      } else {
        monthlyPayment = principal * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / 
                         (Math.pow(1 + monthlyRate, numPayments) - 1);
      }

      const loanData = {
        userId: data.userId,
        type: data.type,
        amount: data.amount,
        interestRate: data.interestRate,
        termMonths: parseInt(data.termMonths),
        monthlyPayment: monthlyPayment.toFixed(2),
        remainingBalance: data.amount,
        status: data.status,
        notes: data.notes || undefined,
        approvedBy: data.status === 'approved' ? user?.id : undefined,
      };

      return apiRequest('/api/loans', {
        method: 'POST',
        body: JSON.stringify(loanData),
      });
    },
    onSuccess: () => {
      toast({
        title: "Loan Created Successfully",
        description: "The loan application has been created.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/loans'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      onSuccess();
      form.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Creation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: StaffLoanFormData) => {
    createLoanMutation.mutate(data);
  };

  // Filter to get only account holders
  const accountHolders = users.filter(u => u.role === 'Account Holder');

  return (
    <div className="space-y-6">
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
                    {accountHolders.map((accountHolder) => (
                      <SelectItem key={accountHolder.id} value={accountHolder.id}>
                        {accountHolder.name} ({accountHolder.email})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Loan Type */}
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Loan Type</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select loan type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="personal">Personal Loan</SelectItem>
                    <SelectItem value="auto">Auto Loan</SelectItem>
                    <SelectItem value="mortgage">Mortgage</SelectItem>
                    <SelectItem value="business">Business Loan</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Loan Amount */}
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Loan Amount ($)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Enter loan amount"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Interest Rate */}
            <FormField
              control={form.control}
              name="interestRate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Interest Rate (%)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="5.5"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* Term in Months */}
          <FormField
            control={form.control}
            name="termMonths"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Term (Months)</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select loan term" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="12">12 months (1 year)</SelectItem>
                    <SelectItem value="24">24 months (2 years)</SelectItem>
                    <SelectItem value="36">36 months (3 years)</SelectItem>
                    <SelectItem value="48">48 months (4 years)</SelectItem>
                    <SelectItem value="60">60 months (5 years)</SelectItem>
                    <SelectItem value="72">72 months (6 years)</SelectItem>
                    <SelectItem value="84">84 months (7 years)</SelectItem>
                    <SelectItem value="120">120 months (10 years)</SelectItem>
                    <SelectItem value="180">180 months (15 years)</SelectItem>
                    <SelectItem value="240">240 months (20 years)</SelectItem>
                    <SelectItem value="360">360 months (30 years)</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Initial Status (Bank Managers can approve directly) */}
          {user?.role === 'Bank Manager' && (
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Initial Status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select initial status" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="offered">Offer to Customer</SelectItem>
                      <SelectItem value="pending">Hold for Review</SelectItem>
                      <SelectItem value="approved">Pre-approved (if customer accepts)</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {/* Notes */}
          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Notes (Optional)</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Additional notes about the loan application..."
                    className="min-h-[100px]"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Monthly Payment Preview */}
          {form.watch('amount') && form.watch('interestRate') && form.watch('termMonths') && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="font-medium text-blue-900 mb-2">Loan Summary</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-blue-700">Principal:</span>
                  <span className="ml-2 font-medium">
                    ${parseFloat(form.watch('amount') || '0').toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-blue-700">Interest Rate:</span>
                  <span className="ml-2 font-medium">{form.watch('interestRate')}%</span>
                </div>
                <div>
                  <span className="text-blue-700">Term:</span>
                  <span className="ml-2 font-medium">{form.watch('termMonths')} months</span>
                </div>
                <div>
                  <span className="text-blue-700">Est. Monthly Payment:</span>
                  <span className="ml-2 font-medium text-blue-900">
                    ${(() => {
                      const principal = parseFloat(form.watch('amount') || '0');
                      const monthlyRate = parseFloat(form.watch('interestRate') || '0') / 100 / 12;
                      const numPayments = parseInt(form.watch('termMonths') || '0');
                      
                      if (principal && monthlyRate && numPayments) {
                        let monthlyPayment: number;
                        if (monthlyRate === 0) {
                          monthlyPayment = principal / numPayments;
                        } else {
                          monthlyPayment = principal * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / 
                                           (Math.pow(1 + monthlyRate, numPayments) - 1);
                        }
                        return monthlyPayment.toFixed(2);
                      }
                      return '0.00';
                    })()}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end space-x-3">
            <Button
              type="button"
              variant="outline"
              onClick={onSuccess}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createLoanMutation.isPending}>
              {createLoanMutation.isPending 
                ? 'Creating...' 
                : form.watch('status') === 'offered'
                  ? 'Send Offer to Customer'
                  : form.watch('status') === 'approved'
                    ? 'Create & Pre-approve'
                    : 'Create Loan Application'
              }
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}