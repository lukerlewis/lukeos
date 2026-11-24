ALTER TABLE "x_people" ADD COLUMN "company" text;--> statement-breakpoint
UPDATE "x_people" SET "company" = c.company FROM (VALUES
  ('emieljanson','Linear'),('griveau','Linear'),('julianlehr','Linear'),('yannglt','Linear'),
  ('witsdev','Vercel'),('evilrabbit_','Vercel'),('jdsimcoe','Vercel'),
  ('guiseiz','Figma'),('nlevin','Figma'),('samoshin','Figma'),('benjkowalski','Figma'),('elou','Figma'),('billy_sweeney','Figma'),
  ('scspeier','Perplexity'),('pklada','Perplexity'),('chanpory','Perplexity'),('gunnargray','Perplexity'),
  ('joranentjes','Framer'),('edoardomercati','Framer'),('maxxthedesigner','Framer'),
  ('arylxl','Mercury'),('dxni_gd','Mercury'),('verlichen','Mercury'),('maxwellbrandon','Mercury')
) AS c(handle, company) WHERE lower("x_people"."handle") = c.handle AND "x_people"."company" IS NULL;
