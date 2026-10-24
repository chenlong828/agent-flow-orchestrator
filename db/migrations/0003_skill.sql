-- Skill 聚合：分类参考数据、聚合根与五类有序子表。

create table skill_category (
  code text primary key,
  label text not null,
  position integer not null check (position >= 0),
  unique (position)
);

insert into skill_category (code, label, position) values
  ('coding', '编码', 0),
  ('retrieval', '检索', 1),
  ('review', '审视', 2),
  ('testing', '测试', 3)
on conflict (code) do nothing;

create table skill (
  id uuid primary key,
  name text not null,
  category_code text not null references skill_category (code) on delete restrict,
  summary text not null check (char_length(summary) <= 200),
  version text not null check (version ~ '^v[0-9]+\.[0-9]+$'),
  enabled boolean not null default true,
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  check (char_length(name) between 1 and 80)
);

create unique index skill_name_lower_key on skill (lower(name));
create index skill_category_code_idx on skill (category_code);
create index skill_enabled_idx on skill (enabled);
create index skill_updated_at_idx on skill (updated_at desc);
create index skill_version_idx on skill (version);

create table skill_tag (
  skill_id uuid not null references skill (id) on delete cascade,
  position integer not null check (position >= 0),
  tag text not null check (char_length(tag) > 0),
  primary key (skill_id, position),
  unique (skill_id, tag)
);

create index skill_tag_tag_idx on skill_tag (tag);

create table skill_trigger (
  skill_id uuid not null references skill (id) on delete cascade,
  position integer not null check (position >= 0),
  keyword text not null check (char_length(keyword) > 0),
  primary key (skill_id, position),
  unique (skill_id, keyword)
);

create table skill_section (
  skill_id uuid not null references skill (id) on delete cascade,
  kind text not null check (kind in ('overview', 'steps', 'examples', 'scripts', 'verification')),
  content_md text not null default '',
  primary key (skill_id, kind)
);

create table skill_pitfall (
  skill_id uuid not null references skill (id) on delete cascade,
  position integer not null check (position >= 0),
  content text not null check (char_length(content) > 0),
  primary key (skill_id, position)
);

create table skill_ref (
  skill_id uuid not null references skill (id) on delete cascade,
  position integer not null check (position >= 0),
  label text not null check (char_length(label) > 0),
  ref_type text not null,
  path text,
  primary key (skill_id, position)
);
