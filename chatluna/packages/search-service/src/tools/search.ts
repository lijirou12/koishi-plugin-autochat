/* eslint-disable max-len */
import { Tool } from '@langchain/core/tools'
import { SearchManager } from '../provide'
import { PuppeteerBrowserTool } from './puppeteerBrowserTool'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { MemoryVectorStore } from 'koishi-plugin-chatluna/llm-core/vectorstores'
import { Embeddings } from '@langchain/core/embeddings'
import { Document } from '@langchain/core/documents'
import { SearchResult, SummaryType } from '../types'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { PromptTemplate } from '@langchain/core/prompts'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
/* import fs from 'fs/promises' */
import { emptyEmbeddings } from 'koishi-plugin-chatluna/llm-core/model/in_memory'
import { logger } from '..'
import { removeProperty } from '../utils/parse'

export class SearchTool extends Tool {
    name = 'web_search'

    // eslint-disable-next-line max-len
    description = `An search engine. Useful for when you need to answer questions about current events. Input should be a raw string of keyword. About Search Keywords, you should cut what you are searching for into several keywords and separate them with spaces. For example, "What is the weather in Beijing today?" would be "Beijing weather today"`

    private _textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: 600,
        chunkOverlap: 100
    })

    constructor(
        private searchManager: SearchManager,
        private browserTool: PuppeteerBrowserTool,
        private embeddings: Embeddings,
        private llm: ChatLunaChatModel,
        private summaryType: SummaryType
    ) {
        super({})
    }

    async _call(arg: string): Promise<string> {
        const documents = await this.fetchSearchResult(arg)

        if (this.summaryType !== SummaryType.Balanced) {
            return JSON.stringify(
                documents.map((document) =>
                    Object.assign({}, document.metadata as SearchResult)
                )
            )
        }

        const fakeSearchResult = await generateFakeSearchResult(arg, this.llm)

        return JSON.stringify(
            await this._reRankDocuments(
                getMessageContent(fakeSearchResult.content),
                documents
            )
        )
    }

    private async fetchSearchResult(query: string) {
        const results = await this.searchManager.search(query)

        if (this.summaryType === SummaryType.Quality) {
            return await Promise.all(
                results.map(async (result, k) => {
                    let pageContent = result.description

                    if (pageContent == null || pageContent.length < 500) {
                        const browserContent: string =
                            await this.browserTool.invoke({
                                url: result.url,
                                action: 'summarize',
                                params: query
                            })

                        if (
                            !browserContent.includes(
                                'Error getting page text:'
                            ) &&
                            !browserContent.includes(
                                'Error summarizing page:'
                            ) &&
                            browserContent !== '[none]'
                        ) {
                            pageContent = browserContent
                        }
                    }

                    if (pageContent == null) {
                        return
                    }

                    const chunks = await this._textSplitter
                        .splitText(pageContent)
                        .then((chunks) => {
                            return chunks.map(
                                (chunk) =>
                                    ({
                                        pageContent: chunk,
                                        metadata: Object.assign(
                                            { description: chunks },
                                            removeProperty(result, [
                                                'description'
                                            ])
                                        )
                                    }) as Document
                            )
                        })

                    return chunks
                })
            ).then((documents) => documents.flat())
        } else if (this.summaryType === SummaryType.Balanced) {
            return await Promise.all(
                results.map(async (result, k) => {
                    let pageContent = result.description

                    if (pageContent == null || pageContent.length < 500) {
                        const browserContent: string =
                            await this.browserTool.invoke({
                                url: result.url,
                                action: 'text'
                            })

                        if (
                            !browserContent.includes(
                                'Error getting page text:'
                            ) &&
                            !browserContent.includes(
                                'Error summarizing page:'
                            ) &&
                            browserContent !== '[none]'
                        ) {
                            pageContent = browserContent
                        }
                    }

                    if (pageContent == null) {
                        return
                    }

                    const chunks = await this._textSplitter
                        .splitText(pageContent)
                        .then((chunks) => {
                            return chunks.map(
                                (chunk) =>
                                    ({
                                        pageContent: chunk,
                                        metadata: result
                                    }) as Document
                            )
                        })

                    return chunks
                })
            ).then((documents) => documents.flat())
        }

        return results.map(
            (result) =>
                ({
                    pageContent: result.description,
                    metadata: result
                }) as Document
        )
    }

    private async _reRankDocuments(query: string, documents: Document[]) {
        if (this.embeddings === emptyEmbeddings) {
            logger.warn('Embeddings is empty, try check your config')
            return documents
                .map((document) => document.metadata as SearchResult)
                .slice(0, this.searchManager.config.topK * 2)
        }

        const vectorStore = new MemoryVectorStore(this.embeddings)

        await vectorStore.addDocuments(documents)

        const searchResult = await vectorStore.similaritySearchWithScore(
            query,
            this.searchManager.config.topK * 2
        )

        /*   for (const [index, result] of searchResult.entries()) {
            await fs.writeFile(`tmp/tmp-${index}.txt`, result[0].pageContent)
        } */

        return searchResult
            .filter(
                (result) =>
                    result[1] > this.searchManager.config.searchThreshold
            )
            .map((result) => result[0].metadata as SearchResult)
            .slice(0, this.searchManager.config.topK)
    }
}

export async function generateFakeSearchResult(
    query: string,
    llm: ChatLunaChatModel
) {
    return llm.invoke(
        await GENERATE_FAKE_SEARCH_RESULT_PROMPT.format({ query }),
        {
            temperature: 0
        }
    )
}

const GENERATE_FAKE_SEARCH_RESULT_PROMPT = new PromptTemplate({
    template: `Based on the question: "{query}"

Generate a brief, factual answer that:
- Directly addresses the core question
- Uses clear and concise language
- Stays between 50-100 characters
- Contains key factual information
- Avoids speculation or uncertainty

Answer the question as if you are a search result snippet.`,
    inputVariables: ['query']
})
