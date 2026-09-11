-- Migration 013: Human-in-loop Strategy on use cases (Analysis section)

ALTER TABLE use_cases ADD COLUMN human_in_loop_strategy VARCHAR(500);
