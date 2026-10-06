import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import type { User } from '../../../shared/schema';

// Form schema based on the backend updateAccountHolderProfileSchema
const profileFormSchema = z.object({
  fullName: z.string().min(2, "Full name must be at least 2 characters").optional(),
  ssn: z.string().regex(/^\d{3}-\d{2}-\d{4}$/, "SSN must be in format XXX-XX-XXXX").optional(),
  dateOfBirth: z.string().optional(),
  homeAddress: z.string().min(5, "Home address must be at least 5 characters").optional(),
  phone: z.string().regex(/^\+?[\d\s\-\(\)]+$/, "Invalid phone number format").optional(),
  alternatePhone: z.string().regex(/^\+?[\d\s\-\(\)]+$/, "Invalid phone number format").optional(),
  email: z.string().email("Invalid email format").optional(),
  employerName: z.string().min(2, "Employer name must be at least 2 characters").optional(),
  annualIncome: z.string().refine((val) => !val || (!isNaN(Number(val)) && Number(val) >= 0), {
    message: "Annual income must be a positive number",
  }).optional(),
  creditScore: z.number().int().min(300).max(850).optional(),
});

type ProfileFormData = z.infer<typeof profileFormSchema>;

interface EditProfileModalProps {
  user: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUserRole: string;
}

export function EditProfileModal({ user, open, onOpenChange, currentUserRole }: EditProfileModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pendingApproval, setPendingApproval] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      fullName: user.fullName || '',
      ssn: user.ssn || '',
      dateOfBirth: user.dateOfBirth ? new Date(user.dateOfBirth).toISOString().split('T')[0] : '',
      homeAddress: user.homeAddress || '',
      phone: user.phone || '',
      alternatePhone: user.alternatePhone || '',
      email: user.email || '',
      employerName: user.employerName || '',
      annualIncome: user.annualIncome || '',
      creditScore: user.creditScore || undefined,
    }
  });

  const updateProfileMutation = useMutation({
    mutationFn: (data: ProfileFormData) => apiRequest(`/api/users/${user.id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      queryClient.invalidateQueries({ queryKey: ['/api/users', user.id] });
      
      if (response.pendingApproval) {
        setPendingApproval(true);
        toast({
          title: "Changes Submitted",
          description: "Your changes have been submitted for Manager approval.",
        });
      } else {
        toast({
          title: "Profile Updated",
          description: "The profile has been updated successfully.",
        });
        onOpenChange(false);
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update profile",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: ProfileFormData) => {
    // Remove empty fields
    const cleanedData = Object.fromEntries(
      Object.entries(data).filter(([_, value]) => value !== '' && value !== undefined)
    );
    updateProfileMutation.mutate(cleanedData);
  };

  const handleClose = () => {
    reset();
    setPendingApproval(false);
    onOpenChange(false);
  };

  // Check if user has SSN access
  const canViewSSN = currentUserRole === 'Bank Manager' || currentUserRole === 'Bank Teller';
  const canEditSSN = currentUserRole === 'Bank Manager' || currentUserRole === 'Bank Teller';
  const isBankTeller = currentUserRole === 'Bank Teller';

  // Fields that require manager approval when changed by Bank Tellers
  const sensitiveFields = ['ssn', 'creditScore', 'annualIncome', 'homeAddress'];
  const formData = watch();
  const hasSensitiveChanges = isBankTeller && sensitiveFields.some(field => 
    formData[field as keyof ProfileFormData] !== user[field as keyof User]
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="modal-edit-profile">
        <DialogHeader>
          <DialogTitle>Edit Account Holder Profile</DialogTitle>
        </DialogHeader>

        {pendingApproval ? (
          <div className="p-6 text-center">
            <Badge variant="outline" className="mb-4">Pending Manager Approval</Badge>
            <p className="text-sm text-muted-foreground mb-4">
              Your changes have been submitted and are awaiting Manager approval.
            </p>
            <Button onClick={handleClose}>Close</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/* Basic Information */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="fullName">Full Legal Name</Label>
                <Input
                  id="fullName"
                  {...register('fullName')}
                  data-testid="input-full-name"
                />
                {errors.fullName && (
                  <p className="text-sm text-red-500 mt-1">{errors.fullName.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="dateOfBirth">Date of Birth</Label>
                <Input
                  id="dateOfBirth"
                  type="date"
                  {...register('dateOfBirth')}
                  data-testid="input-date-of-birth"
                />
                {errors.dateOfBirth && (
                  <p className="text-sm text-red-500 mt-1">{errors.dateOfBirth.message}</p>
                )}
              </div>
            </div>

            {/* SSN - Bank Managers and Tellers */}
            {canViewSSN && (
              <div>
                <Label htmlFor="ssn">
                  Social Security Number
                  {isBankTeller && <Badge variant="outline" className="ml-2">Requires Approval</Badge>}
                </Label>
                <Input
                  id="ssn"
                  {...register('ssn')}
                  placeholder="XXX-XX-XXXX"
                  disabled={false}
                  data-testid="input-ssn"
                />
                {errors.ssn && (
                  <p className="text-sm text-red-500 mt-1">{errors.ssn.message}</p>
                )}
              </div>
            )}

            {/* Contact Information */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  {...register('email')}
                  data-testid="input-email"
                />
                {errors.email && (
                  <p className="text-sm text-red-500 mt-1">{errors.email.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="phone">Primary Phone</Label>
                <Input
                  id="phone"
                  {...register('phone')}
                  placeholder="(555) 123-4567"
                  data-testid="input-phone"
                />
                {errors.phone && (
                  <p className="text-sm text-red-500 mt-1">{errors.phone.message}</p>
                )}
              </div>
            </div>

            <div>
              <Label htmlFor="alternatePhone">Alternate Phone</Label>
              <Input
                id="alternatePhone"
                {...register('alternatePhone')}
                placeholder="(555) 987-6543"
                data-testid="input-alternate-phone"
              />
              {errors.alternatePhone && (
                <p className="text-sm text-red-500 mt-1">{errors.alternatePhone.message}</p>
              )}
            </div>

            {/* Address */}
            <div>
              <Label htmlFor="homeAddress">
                Home Address
                {isBankTeller && <Badge variant="outline" className="ml-2">Requires Approval</Badge>}
              </Label>
              <Textarea
                id="homeAddress"
                {...register('homeAddress')}
                placeholder="Street address, city, state, ZIP code"
                rows={3}
                data-testid="textarea-home-address"
              />
              {errors.homeAddress && (
                <p className="text-sm text-red-500 mt-1">{errors.homeAddress.message}</p>
              )}
            </div>

            {/* Employment Information */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="employerName">Employer Name</Label>
                <Input
                  id="employerName"
                  {...register('employerName')}
                  data-testid="input-employer-name"
                />
                {errors.employerName && (
                  <p className="text-sm text-red-500 mt-1">{errors.employerName.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="annualIncome">
                  Annual Income
                  {isBankTeller && <Badge variant="outline" className="ml-2">Requires Approval</Badge>}
                </Label>
                <Input
                  id="annualIncome"
                  {...register('annualIncome')}
                  placeholder="75000"
                  data-testid="input-annual-income"
                />
                {errors.annualIncome && (
                  <p className="text-sm text-red-500 mt-1">{errors.annualIncome.message}</p>
                )}
              </div>
            </div>

            {/* Credit Score - Bank Staff Only */}
            <div>
              <Label htmlFor="creditScore">
                Credit Score
                {isBankTeller && <Badge variant="outline" className="ml-2">Requires Approval</Badge>}
              </Label>
              <Input
                id="creditScore"
                type="number"
                min="300"
                max="850"
                {...register('creditScore', { valueAsNumber: true })}
                placeholder="720"
                data-testid="input-credit-score"
              />
              {errors.creditScore && (
                <p className="text-sm text-red-500 mt-1">{errors.creditScore.message}</p>
              )}
            </div>

            {/* Warning for Bank Tellers about approval */}
            {hasSensitiveChanges && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <p className="text-sm text-yellow-800">
                  <strong>Note:</strong> Changes to sensitive fields (address, income, credit score) 
                  will require Manager approval before being applied.
                </p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end gap-3 pt-4">
              <Button 
                type="button" 
                variant="outline" 
                onClick={handleClose}
                data-testid="button-cancel"
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={updateProfileMutation.isPending}
                data-testid="button-save-profile"
              >
                {updateProfileMutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}