-- Migration 009: Update AI category taxonomy
-- C -> P (Predictive AI), D -> A (Autonomous AI), G -> G, H -> S (Decision-Support)

UPDATE use_cases SET ai_category = 'P' WHERE ai_category = 'C';
UPDATE use_cases SET ai_category = 'A' WHERE ai_category = 'D';
UPDATE use_cases SET ai_category = 'S' WHERE ai_category = 'H';
