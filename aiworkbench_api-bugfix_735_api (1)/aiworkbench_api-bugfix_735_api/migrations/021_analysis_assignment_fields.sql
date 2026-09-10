-- Analysis assignment, completion/rejection tracking, and scoring fields on use_cases.
-- Applied at startup via database.run_migrations() ALTER TABLE ADD COLUMN.

-- Assignment
-- analysis_assigned_by, analysis_assigned_dt, analysis_due_date
-- tech_analysis_completed_dt, business_analysis_completed_dt
-- tech_analysis_rejected_dt, tech_analysis_rejection_note
-- business_analysis_rejected_dt, business_analysis_rejection_note

-- Business scoring
-- frequency_of_task, current_effort, user_group_size, efficiency_impact,
-- quality_compliance_impact, user_urgency, process_impact, operational_compliance_risk

-- Technical scoring
-- tool_complexity, host_system_capability, data_privacy_security
-- (feasibility derived from tool_complexity + host_system_capability)
