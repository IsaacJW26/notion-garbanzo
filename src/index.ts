/* ================================================================================

  notion-github-sync.
  
  Glitch example: https://glitch.com/edit/#!/notion-github-sync
  Find the official Notion API client @ https://github.com/makenotion/notion-sdk-js/

================================================================================ */

//import { time } from "console"

const { Client } = require("@notionhq/client")
const dotenv = require("dotenv")
const _ = require("lodash")

dotenv.config()
const notion = new Client({ auth: process.env.NOTION_KEY })

const databaseId = process.env.NOTION_DATABASE_ID
const OPERATION_BATCH_SIZE = 10

/**
 * Local map to store  GitHub issue ID to its Notion pageId.
 * { [issueId: string]: string }
 */
const allDatabasePages = {};
const pagesWithEmptyFields = [];

/**
 * Initialize local data store.
 * Then sync with GitHub.
 */
setInitialGitHubToNotionIdMap().then(syncNotionDatabaseWithGitHub)
//setInitialGitHubToNotionIdMap()

/**
 * Get and set the initial data store with issues currently in the database.
 */
async function setInitialGitHubToNotionIdMap() {

  console.log("Fetching from Notion ...")

  const currentPages = await getPageFromNotionDatabase();

  for (const page of currentPages) {
    let pageWithNewDefault = setDefaults(page);
    if (pageWithNewDefault) {
      pagesWithEmptyFields.push(pageWithNewDefault);
      console.log(`pageId ${page.title} has empty fields: ${JSON.stringify(page)}`);
    }
  }
}

async function syncNotionDatabaseWithGitHub() {
  // Get all issues currently in the provided GitHub repository.
  console.log("\nFetching issues from Notion DB...")

  // Group issues into those that need to be created or updated in the Notion database.
  const { pagesToUpdate } = getNotionOperations(pagesWithEmptyFields)
  console.log(`pagesToUpdate: ${pagesToUpdate.length}`)

  // Create pages for new issues.
  //console.log(`\n${pagesToCreate.length} new issues to add to Notion.`)
  //await createPages(pagesToCreate)

  // Updates pages for existing issues.
  //console.log(`\n${pagesToUpdate.length} issues to update in Notion.`)
  //await updatePages(pagesToUpdate);

  // Success!
  console.log("\n✅ Notion database is updated.")

}

/**
 * Gets pages from the Notion database.
 *
 * @returns {Promise<Array<{ pageId: string, issueNumber: number }>>}
 */
async function getPageFromNotionDatabase() {
  const pages = []
  let cursor = undefined
  while (true) {
    const { results, next_cursor } = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
    })
    pages.push(...results)
    if (!next_cursor) {
      break
    }
    cursor = next_cursor
  }
  console.log(`${pages.length} issues successfully fetched.`)
  return pages.map(page => {
    //console.log(`fetched id: ${page.id}, title: ${JSON.stringify(page.properties["Name"].title["plain_text"]}`);
    console.log(`fetched id: ${page.id}, title: ${page.properties.Name.title[0]?.plain_text}`);

    return {
      pageId: page.id,
      title: page.properties.Name.title[0]?.plain_text,
      due_date: page.properties["DUE"]?.date,
      status: page.properties["Status"]?.select.name,
      completed: page.properties["Completed"]?.date,
    }
  })
}

function setDefaults(properties) {
  let outObject = {
    pageId: properties.pageId,
    title: properties.title,
    due_date: properties.due_date,
    status: properties.status,
    completed: properties.completed
  }

  let hasEmptyField: boolean = false;
  console.log(`Title = ${properties.title}`);

  if (!properties.due_date) {

    let newDueDate: Date = new Date();
    newDueDate.setDate(newDueDate.getDate() + 7);
    outObject.due_date = newDueDate;

    hasEmptyField = true;
  }
  console.log(`Property = ${JSON.stringify(properties.status)}`);

  if (!properties.status) {
    console.log(`Property is null `);

    outObject.status = "Pending";
    hasEmptyField = true;
  }

  if(!properties.completed)
  {
    if(properties.status == "Completed"){
      let newCompleteDate: Date = new Date();
      outObject.completed = newCompleteDate.getDate();

      hasEmptyField = true;
    }
  }

  if(hasEmptyField){
    return outObject;
  }

  return null;
}

/**
 * Determines which issues already exist in the Notion database.
 *
 * @param {Array<{ number: number, title: string, state: "open" | "closed", comment_count: number, url: string }>} issues
 * @returns {{
 *   pagesToCreate: Array<{ number: number, title: string, state: "open" | "closed", comment_count: number, url: string }>;
 *   pagesToUpdate: Array<{ pageId: string, number: number, title: string, state: "open" | "closed", comment_count: number, url: string }>
 * }}
 */

function getNotionOperations(pages) {
  //const pagesToCreate = []
  const pagesToUpdate = [];
  console.log(`page size: ${pages.length}`)
  for (const page of pages) {
    //const pageId = gitHubIssuesIdToNotionPageId[issue.number]
    console.log("add to pages to update: " + JSON.stringify(page));

    if (page.pageId) {
      pagesToUpdate.push({
        pageId: page.pageId,
        properties: {
          due_date: page.due_date,
          title: page.title,
          completed: page.completed,
          status: page.status,
        }
      });
    }
  }
  return { pagesToUpdate }
}

/**
 * Updates provided pages in Notion.
 *
 * https://developers.notion.com/reference/patch-page
 *
 * @param {Array<{ pageId: string, number: number, title: string, state: "open" | "closed", comment_count: number, url: string }>} pagesToUpdate
 */

async function updatePages(pagesToUpdate) {
  const pagesToUpdateChunks = _.chunk(pagesToUpdate, OPERATION_BATCH_SIZE)
  for (const pagesToUpdateBatch of pagesToUpdateChunks) {
    await Promise.all(
      pagesToUpdateBatch.map(({ pageId, properties }) => {
        console.log(`update: page { ${pageId}, ${properties.title}, with date ${properties.due_date}`);

        notion.pages.update({
          page_id: pageId,
          properties: getPropertiesForPage(properties),
        });
      }
      )
    )
    console.log(`Completed batch size: ${pagesToUpdateBatch.length}`)
  }
}


//*========================================================================
// Helpers
//*========================================================================

/**
 * Returns the GitHub issue to conform to this database's schema properties.
 *
 * @param {{ number: number, title: string, state: "open" | "closed", comment_count: number, url: string }} issue
 */
function getPropertiesForPage(pageInfo) {
  const { due_date, title, completed, status } = pageInfo
  return {
    Name: {
      title: [{ type: "text", text: { content: title } }],
    },
    "DUE": {
      date: { start: due_date }
    },
    "Completed": completed,
    "Status": {
      select: { name: status }
    }
  }
}

// {
//   "object": "page",
//   "id": "7d32a527-52d0-4fc1-b61a-f9718d089773",
//   "created_time": "2021-01-06T06:47:00.000Z",
//   "last_edited_time": "2021-02-01T04:05:00.000Z",
//   "cover": null,
//   "icon": null,
//   "parent": {
//     "type": "database_id",
//     "database_id": "3b480263-820e-4de9-9a7c-204eb8901d94"
//   },
//   "archived": false,
//   "properties": {
//     "Priority": {
//       "id": "@hjk",
//       "type": "select",
//       "select": {
//         "id": "ba474773-934f-4320-bac0-61e4f1c05e28",
//         "name": "Med",
//         "color": "blue"
//       }
//     },
//     "Project": {
//       "id": "EA@p",
//       "type": "relation",
//       "relation": []
//     },
//     "Status": {
//       "id": "Ft:E",
//       "type": "select",
//       "select": {
//         "id": "30da25a5-a575-49d6-b0d4-0e960d99dd93",
//         "name": "Complete",
//         "color": "blue"
//       }
//     },
//     "Urgency Score": {
//       "id": "G?V_",
//       "type": "formula",
//       "formula": {
//         "type": "number",
//         "number": 400
//       }
//     },
//     "E value": {
//       "id": "MnZR",
//       "type": "formula",
//       "formula": {
//         "type": "number",
//         "number": 1942
//       }
//     },
//     "Created": {
//       "id": "\\zOW",
//       "type": "created_time",
//       "created_time": "2021-01-06T06:47:00.000Z"
//     },
//     "Status Value": {
//       "id": "_[\\B",
//       "type": "formula",
//       "formula": {
//         "type": "number",
//         "number": 0
//       }
//     },
//     "DUE": {
//       "id": "i_Hi",
//       "type": "date",
//       "date": {
//         "start": "2021-01-07",
//         "end": null
//       }
//     },
//     "Completed": {
//       "id": "jc>K",
//       "type": "date",
//       "date": {
//         "start": "2021-01-07",
//         "end": null
//       }
//     },
//     "Parent Task": {
//       "id": "u{B|",
//       "type": "relation",
//       "relation": [
//         {
//           "id": "41e788ed-75ae-4de2-a17f-f09d2793f8ac"
//         }
//       ]
//     },
//     "Priority Score": {
//       "id": "vsR}",
//       "type": "formula",
//       "formula": {
//         "type": "number",
//         "number": 2
//       }
//     },
//     "Age Score": {
//       "id": "~^:H",
//       "type": "formula",
//       "formula": {
//         "type": "number",
//         "number": 142
//       }
//     },
//     "Name": {
//       "id": "title",
//       "type": "title",
//       "title": [
//         {
//           "type": "text",
//           "text": {
//             "content": "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
//             "link": null
//           },
//           "annotations": {
//             "bold": false,
//             "italic": false,
//             "strikethrough": false,
//             "underline": false,
//             "code": false,
//             "color": "default"
//           },
//           "plain_text": "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
//           "href": null
//         }
//       ]
//     }
//   },
//   "url": "https://www.notion.so/XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXd04fc1b61af9718d089773"
// }