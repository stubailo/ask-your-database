# Query your database with GPT

A CLI tool that will let you ask GPT questions about any Postgres database. Just provide your connection details, and ask-your-database automatically loads up the schema, example data, and runs queries for you.

> Note: This will directly run queries provided by GPT on the database that you provide. Unless it's a read-only connection, that means it might delete or update data by accident. Please use with caution and always keep backups of your data.

## Usage

First, create a JSON configuration file:

```json
{
  "openAIAPIKey": "xxx",
  "openAIModel": "xxx",
  "dbTimeoutMs": 20000,
  "apiTimeoutMs": 30000,
  "postgresConnection": {
    "host": "localhost",
    "port": 5432,
    "database": "imdb",
    "user": "imdb",
    "password": "1234"
  }
}
```

Then, call this with the config file like so:

```sh
npx ask-your-database myConfig.json
```

## What it does

This example is using an example IMDB postgres database from [RyanMarcus/imdb_pg_dataset](https://github.com/RyanMarcus/imdb_pg_dataset). You can load it up by downloading [this archive](https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/2QYZBT) and using `pg_restore --database=db_name --user=user imdb_pg11`.

First, this will tell you a bit about your database, and prompt you for an initial question:

```
> npx ask-your-database@0.1.5 imdbConfig.json

You are connected to the database imdb. It has the following tables:

aka_name, aka_title, cast_info, char_name, comp_cast_type, company_name, company_type,
complete_cast, info_type, keyword, kind_type, link_type, movie_companies, movie_info,
movie_info_idx, movie_keyword, movie_link, name, person_info, role_type, title

? Ask me a question about this database, and I'll try to answer! (q to quit)
```

Then you can put in a question, for example:

```
> What movies did Keanu Reeves act in?
```

If the response includes a SQL query, then this tool will automatically run it for you and show the results:

```
To answer your question, we'll need to join the 'name' table to find Keanu Reeves' person_id, and
then join the 'cast_info' table to get the movie_ids in which Keanu Reeves appeared as an actor, and
finally join the 'title' table to get the titles of those movies.

Please run the following query:

SELECT title.title
FROM name
JOIN cast_info ON name.id = cast_info.person_id
JOIN title ON cast_info.movie_id = title.id
JOIN role_type ON cast_info.role_id = role_type.id
WHERE name.name ILIKE 'Reeves, Keanu' AND role_type.role = 'actor';

Returned 253 rows. Here are the first 101 rows:
┌─────────┬────────────────────────────────────────────────────────────────────────────┐
│ (index) │                                   title                                    │
├─────────┼────────────────────────────────────────────────────────────────────────────┤
│    0    │                        '101 Biggest Celebrity Oops'                        │
│    1    │                          '1992 MTV Movie Awards'                           │
│    2    │                          '1993 MTV Movie Awards'                           │
│    3    │                          '1995 MTV Movie Awards'                           │
│    4    │                          '1999 MTV Movie Awards'                           │
│    5    │                  '2000 Blockbuster Entertainment Awards'                   │
│    6    │                          '2003 MTV Movie Awards'                           │
│    7    │                      '2004 Taurus World Stunt Awards'                      │
│    8    │                          '2006 MTV Movie Awards'                           │
│    9    │                                 '47 Ronin'                                 │
│   10    │                              "A Man's Story"                               │
│   11    │                             'A Scanner Darkly'                             │

... some results truncated
```

When you send the response to GPT, the result will be included:

```
> This is great, but it includes things that aren't movies. Can you filter to only
movies, and also sort to show the most recent first?
```

Using the new results and the past context, GPT will then run more queries and improve its results:

```
To filter only movies and sort them by the most recent first, we need to join the 'kind_type' table
to get the movie kind and filter by 'movie', and order the result by 'production_year' in descending
order. Please run the following query:

SELECT title.title, title.production_year
FROM name
JOIN cast_info ON name.id = cast_info.person_id
JOIN title ON cast_info.movie_id = title.id
JOIN role_type ON cast_info.role_id = role_type.id
JOIN kind_type ON title.kind_id = kind_type.id
WHERE name.name ILIKE 'Reeves, Keanu' AND role_type.role = 'actor' AND kind_type.kind = 'movie'
ORDER BY title.production_year DESC;

Returned 64 rows. Here are the first 51 rows:
┌─────────┬─────────────────────────────────────┬─────────────────┐
│ (index) │                title                │ production_year │
├─────────┼─────────────────────────────────────┼─────────────────┤
│    0    │             'John Wick'             │      null       │
│    1    │            'Passengers'             │      null       │
│    2    │              'Jekyll'               │      null       │
│    3    │              'Jekyll'               │      null       │
│    4    │          'Man of Tai Chi'           │      2013       │
│    5    │             '47 Ronin'              │      2013       │
│    6    │           'Side by Side'            │      2012       │
│    7    │         'Generation Um...'          │      2012       │
│    8    │           'Sunset Strip'            │      2012       │

... some results truncated
```

(Our example data set only includes data up to 2013)

Then, you can continue to refine the results:

```
> This is great, but can you omit the ones with null production_year?
```

The response:

```
To omit the ones with null production_year, add a condition in the WHERE clause. Please run the
following query:

SELECT title.title, title.production_year
FROM name
JOIN cast_info ON name.id = cast_info.person_id
JOIN title ON cast_info.movie_id = title.id
JOIN role_type ON cast_info.role_id = role_type.id
JOIN kind_type ON title.kind_id = kind_type.id
WHERE name.name ILIKE 'Reeves, Keanu' AND role_type.role = 'actor' AND kind_type.kind = 'movie' AND title.production_year IS NOT NULL
ORDER BY title.production_year DESC;

Returned 60 rows. Here are the first 51 rows:
┌─────────┬─────────────────────────────────────┬─────────────────┐
│ (index) │ title │ production_year │
├─────────┼─────────────────────────────────────┼─────────────────┤
│ 0 │ '47 Ronin' │ 2013 │
│ 1 │ 'Man of Tai Chi' │ 2013 │
│ 2 │ 'Sunset Strip' │ 2012 │
│ 3 │ 'Side by Side' │ 2012 │
│ 4 │ 'Generation Um...' │ 2012 │
│ 5 │ "A Man's Story" │ 2010 │
│ 6 │ "Henry's Crime" │ 2010 │
│ 7 │ 'The Private Lives of Pippa Lee' │ 2009 │
│ 8 │ 'Street Kings' │ 2008 │
│ 9 │ 'The Day the Earth Stood Still' │ 2008 │

... some results truncated

```

And so on!

## Approach

This combines a few simple things together:

1. First, it queries the database for all of the tables. For each table it gets all the columns, their types, and one example result. All of these are provided as the beginning of the prompt.
2. The schema and your question are sent to GPT.
3. Any queries returned as part of the response are automatically executed, and the result is printed to you.
4. When you send any followup questions, the result is automatically sent so GPT can use it as context for the following responses.

## Local development

Using pnpm or your Node package manager of choice:

```sh
pnpm install
pnpm start yourConfig.json
```

## Additional disclaimers

Note that your database schema and any data queried by GPT will be sent to OpenAI for processing in the cloud. Exercise the appropriate amount of caution depending on your data.
