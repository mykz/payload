'use client'
import React, { Fragment, useCallback, useEffect, useReducer, useRef, useState } from 'react'
import useField from '../../../useField'
import { RelationshipField, Validate, Where } from 'payload/types'
import { FilterOptionsResult, GetResults, Option, Value } from '../types'
import { ReactSelect } from '../../../../elements/ReactSelect'
import { MultiValueLabel } from '../select-components/MultiValueLabel'
import { SingleValue } from '../select-components/SingleValue'
import { AddNewRelation } from '../AddNew'
import { findOptionsByValue } from '../findOptionsByValue'
import optionsReducer from '../optionsReducer'
import { useAuth, useConfig, useLocale, useTranslation } from '../../../..'
import { useFormProcessing } from '../../../Form/context'
import { GetFilterOptions } from '../../../../elements/GetFilterOptions'
import { wordBoundariesRegex } from 'payload/utilities'
import { DocumentDrawerProps } from '../../../../elements/DocumentDrawer/types'
import { createRelationMap } from '../createRelationMap'
import { PaginatedDocs } from 'payload/database'
import QueryString from 'qs'
import { useDebouncedCallback } from '../../../../hooks/useDebouncedCallback'

const maxResultsPerRequest = 10

export const RelationshipInput: React.FC<{
  baseClass?: string
  validate?: Validate
  required?: boolean
  path: string
  readOnly?: boolean
  allowCreate?: boolean
  hasMany?: boolean
  isSortable?: boolean
  filterOptions?: RelationshipField['filterOptions']
  sortOptions?: RelationshipField['admin']['sortOptions']
  relationTo: RelationshipField['relationTo']
}> = (props) => {
  const {
    baseClass,
    validate,
    required,
    path,
    readOnly,
    relationTo,
    allowCreate,
    hasMany,
    isSortable,
    filterOptions,
    sortOptions,
  } = props

  const config = useConfig()

  const {
    collections,
    routes: { api },
    serverURL,
  } = config

  const { i18n, t } = useTranslation()
  const { permissions } = useAuth()
  const { code: locale } = useLocale()
  const formProcessing = useFormProcessing()
  const hasMultipleRelations = Array.isArray(relationTo)
  const [options, dispatchOptions] = useReducer(optionsReducer, [])

  const [lastFullyLoadedRelation, setLastFullyLoadedRelation] = useState(-1)
  const [lastLoadedPage, setLastLoadedPage] = useState<Record<string, number>>({})
  const [errorLoading, setErrorLoading] = useState('')
  const [filterOptionsResult, setFilterOptionsResult] = useState<FilterOptionsResult>()
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [hasLoadedFirstPage, setHasLoadedFirstPage] = useState(false)
  const [enableWordBoundarySearch, setEnableWordBoundarySearch] = useState(false)
  const firstRun = useRef(true)

  const memoizedValidate = useCallback(
    (value, validationOptions) => {
      if (typeof validate === 'function') {
        return validate(value, { ...validationOptions, required })
      }
    },
    [validate, required],
  )

  const { initialValue, setValue, showError, value } = useField<Value | Value[]>({
    path: path,
    validate: memoizedValidate,
  })

  const [drawerIsOpen, setDrawerIsOpen] = useState(false)

  const getResults: GetResults = useCallback(
    async ({
      lastFullyLoadedRelation: lastFullyLoadedRelationArg,
      onSuccess,
      search: searchArg,
      sort,
      value: valueArg,
    }) => {
      if (!permissions) {
        return
      }
      const lastFullyLoadedRelationToUse =
        typeof lastFullyLoadedRelationArg !== 'undefined' ? lastFullyLoadedRelationArg : -1

      const relations = Array.isArray(relationTo) ? relationTo : [relationTo]
      const relationsToFetch =
        lastFullyLoadedRelationToUse === -1
          ? relations
          : relations.slice(lastFullyLoadedRelationToUse + 1)

      let resultsFetched = 0
      const relationMap = createRelationMap({
        hasMany,
        relationTo,
        value: valueArg,
      })

      if (!errorLoading) {
        relationsToFetch.reduce(async (priorRelation, relation) => {
          const relationFilterOption = filterOptionsResult?.[relation]
          let lastLoadedPageToUse
          if (search !== searchArg) {
            lastLoadedPageToUse = 1
          } else {
            lastLoadedPageToUse = lastLoadedPage[relation] + 1
          }
          await priorRelation

          if (relationFilterOption === false) {
            setLastFullyLoadedRelation(relations.indexOf(relation))
            return Promise.resolve()
          }

          if (resultsFetched < 10) {
            const collection = collections.find((coll) => coll.slug === relation)
            let fieldToSearch = collection?.defaultSort || collection?.admin?.useAsTitle || 'id'
            if (!searchArg) {
              if (typeof sortOptions === 'string') {
                fieldToSearch = sortOptions
              } else if (sortOptions?.[relation]) {
                fieldToSearch = sortOptions[relation]
              }
            }

            const query: {
              [key: string]: unknown
              where: Where
            } = {
              depth: 0,
              limit: maxResultsPerRequest,
              locale,
              page: lastLoadedPageToUse,
              sort: fieldToSearch,
              where: {
                and: [
                  {
                    id: {
                      not_in: relationMap[relation],
                    },
                  },
                ],
              },
            }

            if (searchArg) {
              query.where.and.push({
                [fieldToSearch]: {
                  like: searchArg,
                },
              })
            }

            if (relationFilterOption && typeof relationFilterOption !== 'boolean') {
              query.where.and.push(relationFilterOption)
            }

            const response = await fetch(
              `${serverURL}${api}/${relation}?${QueryString.stringify(query)}`,
              {
                credentials: 'include',
                headers: {
                  'Accept-Language': i18n.language,
                },
              },
            )

            if (response.ok) {
              const data: PaginatedDocs<unknown> = await response.json()
              setLastLoadedPage((prevState) => {
                return {
                  ...prevState,
                  [relation]: lastLoadedPageToUse,
                }
              })

              if (!data.nextPage) {
                setLastFullyLoadedRelation(relations.indexOf(relation))
              }

              if (data.docs.length > 0) {
                resultsFetched += data.docs.length

                dispatchOptions({
                  collection,
                  // TODO: fix this
                  // @ts-ignore-next-line
                  config,
                  docs: data.docs,
                  i18n,
                  sort,
                  type: 'ADD',
                })
              }
            } else if (response.status === 403) {
              setLastFullyLoadedRelation(relations.indexOf(relation))
              dispatchOptions({
                collection,
                // TODO: fix this
                // @ts-ignore-next-line
                config,
                docs: [],
                i18n,
                ids: relationMap[relation],
                sort,
                type: 'ADD',
              })
            } else {
              setErrorLoading(t('error:unspecific'))
            }
          }
        }, Promise.resolve())

        if (typeof onSuccess === 'function') onSuccess()
      }
    },
    [
      permissions,
      relationTo,
      hasMany,
      errorLoading,
      search,
      lastLoadedPage,
      collections,
      locale,
      filterOptionsResult,
      serverURL,
      sortOptions,
      api,
      i18n,
      config,
      t,
    ],
  )

  const updateSearch = useDebouncedCallback((searchArg: string, valueArg: Value | Value[]) => {
    getResults({ search: searchArg, sort: true, value: valueArg })
    setSearch(searchArg)
  }, 300)

  const handleInputChange = useCallback(
    (searchArg: string, valueArg: Value | Value[]) => {
      if (search !== searchArg) {
        setLastLoadedPage({})
        updateSearch(searchArg, valueArg, searchArg !== '')
      }
    },
    [search, updateSearch],
  )

  // ///////////////////////////////////
  // Ensure we have an option for each value
  // ///////////////////////////////////

  useEffect(() => {
    const relationMap = createRelationMap({
      hasMany,
      relationTo,
      value,
    })

    Object.entries(relationMap).reduce(async (priorRelation, [relation, ids]) => {
      await priorRelation

      const idsToLoad = ids.filter((id) => {
        return !options.find(
          (optionGroup) =>
            optionGroup?.options?.find(
              (option) => option.value === id && option.relationTo === relation,
            ),
        )
      })

      if (idsToLoad.length > 0) {
        const query = {
          depth: 0,
          limit: idsToLoad.length,
          locale,
          where: {
            id: {
              in: idsToLoad,
            },
          },
        }

        if (!errorLoading) {
          const response = await fetch(
            `${serverURL}${api}/${relation}?${QueryString.stringify(query)}`,
            {
              credentials: 'include',
              headers: {
                'Accept-Language': i18n.language,
              },
            },
          )

          const collection = collections.find((coll) => coll.slug === relation)
          let docs = []

          if (response.ok) {
            const data = await response.json()
            docs = data.docs
          }

          dispatchOptions({
            collection,
            // TODO: fix this
            // @ts-ignore-next-line
            config,
            docs,
            i18n,
            ids: idsToLoad,
            sort: true,
            type: 'ADD',
          })
        }
      }
    }, Promise.resolve())
  }, [
    options,
    value,
    hasMany,
    errorLoading,
    collections,
    hasMultipleRelations,
    serverURL,
    api,
    i18n,
    relationTo,
    locale,
    config,
  ])

  // Determine if we should switch to word boundary search
  useEffect(() => {
    const relations = Array.isArray(relationTo) ? relationTo : [relationTo]
    const isIdOnly = relations.reduce((idOnly, relation) => {
      const collection = collections.find((coll) => coll.slug === relation)
      const fieldToSearch = collection?.admin?.useAsTitle || 'id'
      return fieldToSearch === 'id' && idOnly
    }, true)
    setEnableWordBoundarySearch(!isIdOnly)
  }, [relationTo, collections])

  // When (`relationTo` || `filterOptionsResult` || `locale`) changes, reset component
  // Note - effect should not run on first run
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }

    dispatchOptions({ type: 'CLEAR' })
    setLastFullyLoadedRelation(-1)
    setLastLoadedPage({})
    setHasLoadedFirstPage(false)
  }, [relationTo, filterOptionsResult, locale])

  const onSave = useCallback<DocumentDrawerProps['onSave']>(
    (args) => {
      dispatchOptions({
        collection: args.collectionConfig,
        // TODO: fix this
        // @ts-ignore-next-line
        config,
        doc: args.doc,
        i18n,
        type: 'UPDATE',
      })
    },
    [i18n, config],
  )

  const filterOption = useCallback((item: Option, searchFilter: string) => {
    if (!searchFilter) {
      return true
    }
    const r = wordBoundariesRegex(searchFilter || '')
    // breaking the labels to search into smaller parts increases performance
    const breakApartThreshold = 250
    let string = item.label
    // strings less than breakApartThreshold length won't be chunked
    while (string.length > breakApartThreshold) {
      // slicing by the next space after the length of the search input prevents slicing the string up by partial words
      const indexOfSpace = string.indexOf(' ', searchFilter.length)
      if (r.test(string.slice(0, indexOfSpace === -1 ? searchFilter.length : indexOfSpace + 1))) {
        return true
      }
      string = string.slice(indexOfSpace === -1 ? searchFilter.length : indexOfSpace + 1)
    }
    return r.test(string.slice(-breakApartThreshold))
  }, [])

  const valueToRender = findOptionsByValue({ options, value })

  if (!Array.isArray(valueToRender) && valueToRender?.value === 'null') valueToRender.value = null

  return (
    <Fragment>
      <GetFilterOptions
        {...{
          filterOptions,
          filterOptionsResult,
          path,
          relationTo,
          setFilterOptionsResult,
        }}
      />
      {!errorLoading && (
        <div className={`${baseClass}__wrap`}>
          <ReactSelect
            backspaceRemovesValue={!drawerIsOpen}
            components={{
              MultiValueLabel,
              SingleValue,
            }}
            customProps={{
              disableKeyDown: drawerIsOpen,
              disableMouseDown: drawerIsOpen,
              onSave,
              setDrawerIsOpen,
            }}
            disabled={readOnly || formProcessing}
            filterOption={enableWordBoundarySearch ? filterOption : undefined}
            isLoading={isLoading}
            isMulti={hasMany}
            isSortable={isSortable}
            onChange={
              !readOnly
                ? (selected) => {
                    if (selected === null) {
                      setValue(hasMany ? [] : null)
                    } else if (hasMany) {
                      setValue(
                        selected
                          ? selected.map((option) => {
                              if (hasMultipleRelations) {
                                return {
                                  relationTo: option.relationTo,
                                  value: option.value,
                                }
                              }

                              return option.value
                            })
                          : null,
                      )
                    } else if (hasMultipleRelations) {
                      setValue({
                        relationTo: selected.relationTo,
                        value: selected.value,
                      })
                    } else {
                      setValue(selected.value)
                    }
                  }
                : undefined
            }
            onInputChange={(newSearch) => handleInputChange(newSearch, value)}
            onMenuOpen={() => {
              if (!hasLoadedFirstPage) {
                setIsLoading(true)
                getResults({
                  onSuccess: () => {
                    setHasLoadedFirstPage(true)
                    setIsLoading(false)
                  },
                  value: initialValue,
                })
              }
            }}
            onMenuScrollToBottom={() => {
              getResults({
                lastFullyLoadedRelation,
                search,
                sort: false,
                value: initialValue,
              })
            }}
            options={options}
            showError={showError}
            value={valueToRender ?? null}
          />
          {!readOnly && allowCreate && (
            <AddNewRelation
              {...{
                dispatchOptions,
                hasMany,
                options,
                path,
                relationTo,
                setValue,
                value,
              }}
            />
          )}
        </div>
      )}
      {errorLoading && <div className={`${baseClass}__error-loading`}>{errorLoading}</div>}
    </Fragment>
  )
}