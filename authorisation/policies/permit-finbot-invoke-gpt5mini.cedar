// Standard model: FinBot may call gpt-5-mini (open to the primary agent).
@id("permit-finbot-invoke-gpt5mini")
permit(
    principal == AppPolicies::Agent::"finbot-agent",
    action == AppPolicies::Action::"invokeModel",
    resource == AppPolicies::Model::"gpt-5-mini"
);
