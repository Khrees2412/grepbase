import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// Repositories table - stores cached GitHub repo metadata
export const repositories = sqliteTable('repositories', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    url: text('url').notNull().unique(),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    stars: integer('stars').default(0),
    defaultBranch: text('default_branch').default('main'),
    readme: text('readme'),
    lastFetched: integer('last_fetched', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
    index('idx_repos_owner_name').on(table.owner, table.name),
]);

// Commits table - stores commit history for each repo
export const commits = sqliteTable('commits', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    repoId: integer('repo_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
    sha: text('sha').notNull(),
    message: text('message').notNull(),
    authorName: text('author_name'),
    authorEmail: text('author_email'),
    date: integer('date', { mode: 'timestamp' }).notNull(),
    order: integer('order').notNull(), // 1 = first commit, ascending
}, (table) => [
    index('idx_commits_repo_id').on(table.repoId),
    index('idx_commits_sha').on(table.sha),
]);

// Files table - stores file snapshots at each commit
export const files = sqliteTable('files', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    commitId: integer('commit_id').notNull().references(() => commits.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    content: text('content'),
    size: integer('size').default(0),
    language: text('language'),
}, (table) => [
    index('idx_files_commit_id').on(table.commitId),
]);

// Analyses table - stores cached AI explanations
export const analyses = sqliteTable('analyses', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    commitId: integer('commit_id').notNull().references(() => commits.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(), // gemini, openai, anthropic, ollama
    explanation: text('explanation').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
    index('idx_analyses_commit_id').on(table.commitId),
]);

// Types for inserting and selecting
export type Repository = typeof repositories.$inferSelect;
export type NewRepository = typeof repositories.$inferInsert;
export type Commit = typeof commits.$inferSelect;
export type NewCommit = typeof commits.$inferInsert;
export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;
export type Analysis = typeof analyses.$inferSelect;
export type NewAnalysis = typeof analyses.$inferInsert;
