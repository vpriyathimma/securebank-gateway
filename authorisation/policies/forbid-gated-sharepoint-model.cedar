// Gated model: gpt-5.1-sharepoint is premium and NOT approved for these
// agents. This explicit forbid means the deny a caller sees names THIS policy
// in the Decision Log, rather than a bare "no matching permit". Overrides any
// permit above.
@id("forbid-gated-sharepoint-model")
forbid(
    principal,
    action == AppPolicies::Action::"invokeModel",
    resource == AppPolicies::Model::"gpt-5.1-sharepoint"
);
