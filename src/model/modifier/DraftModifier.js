/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule DraftModifier
 * @typechecks
 * @flow
 */

'use strict';

var CharacterMetadata = require('CharacterMetadata');
var ContentStateInlineStyle = require('ContentStateInlineStyle');
const DraftFeatureFlags = require('DraftFeatureFlags');
var Immutable = require('immutable');

var applyEntityToContentState = require('applyEntityToContentState');
var getCharacterRemovalRange = require('getCharacterRemovalRange');
var getContentStateFragment = require('getContentStateFragment');
var insertFragmentIntoContentState = require('insertFragmentIntoContentState');
var insertTextIntoContentState = require('insertTextIntoContentState');
var invariant = require('invariant');
var modifyBlockForContentState = require('modifyBlockForContentState');
var removeEntitiesAtEdges = require('removeEntitiesAtEdges');
var removeRangeFromContentState = require('removeRangeFromContentState');
var splitBlockInContentState = require('splitBlockInContentState');

import type {BlockMap} from 'BlockMap';
import type ContentState from 'ContentState';
import type {DraftBlockType} from 'DraftBlockType';
import type {DraftInlineStyle} from 'DraftInlineStyle';
import type {DraftRemovalDirection} from 'DraftRemovalDirection';
import type {Map} from 'immutable';
import type SelectionState from 'SelectionState';

const {OrderedSet} = Immutable;

/**
 * `DraftModifier` provides a set of convenience methods that apply
 * modifications to a `ContentState` object based on a target `SelectionState`.
 *
 * Any change to a `ContentState` should be decomposable into a series of
 * transaction functions that apply the required changes and return output
 * `ContentState` objects.
 *
 * These functions encapsulate some of the most common transaction sequences.
 */
var DraftModifier = {
  replaceText: function(
    contentState: ContentState,
    rangeToReplace: SelectionState,
    text: string,
    inlineStyle?: DraftInlineStyle,
    entityKey?: ?string,
  ): ContentState {
    var withoutEntities = removeEntitiesAtEdges(contentState, rangeToReplace);
    var withoutText = removeRangeFromContentState(
      withoutEntities,
      rangeToReplace,
    );

    var character = CharacterMetadata.create({
      style: inlineStyle || OrderedSet(),
      entity: entityKey || null,
    });

    return insertTextIntoContentState(
      withoutText,
      withoutText.getSelectionAfter(),
      text,
      character,
    );
  },

  insertText: function(
    contentState: ContentState,
    targetRange: SelectionState,
    text: string,
    inlineStyle?: DraftInlineStyle,
    entityKey?: ?string,
  ): ContentState {
    invariant(
      targetRange.isCollapsed(),
      'Target range must be collapsed for `insertText`.',
    );
    return DraftModifier.replaceText(
      contentState,
      targetRange,
      text,
      inlineStyle,
      entityKey,
    );
  },

  moveText: function(
    contentState: ContentState,
    removalRange: SelectionState,
    targetRange: SelectionState,
  ): ContentState {
    var movedFragment = getContentStateFragment(contentState, removalRange);

    var afterRemoval = DraftModifier.removeRange(
      contentState,
      removalRange,
      'backward',
    );

    return DraftModifier.replaceWithFragment(
      afterRemoval,
      targetRange,
      movedFragment,
    );
  },

  replaceWithFragment: function(
    contentState: ContentState,
    targetRange: SelectionState,
    fragment: BlockMap,
  ): ContentState {
    var withoutEntities = removeEntitiesAtEdges(contentState, targetRange);
    var withoutText = removeRangeFromContentState(
      withoutEntities,
      targetRange,
    );

    return insertFragmentIntoContentState(
      withoutText,
      withoutText.getSelectionAfter(),
      fragment,
    );
  },

  removeRange: function(
    contentState: ContentState,
    rangeToRemove: SelectionState,
    removalDirection: DraftRemovalDirection,
  ): ContentState {
    let startKey, endKey, startBlock, endBlock;
    startKey = removalDirection === 'forward'
      ? rangeToRemove.getAnchorKey()
      : rangeToRemove.getFocusKey();
    endKey = removalDirection === 'forward'
      ? rangeToRemove.getFocusKey()
      : rangeToRemove.getAnchorKey();
    startBlock = contentState.getBlockForKey(startKey);
    endBlock = contentState.getBlockForKey(endKey);
    const startOffset = rangeToRemove.getStartOffset();
    const endOffset = rangeToRemove.getEndOffset();

    const startEntityKey = startBlock.getEntityAt(startOffset);
    const endEntityKey = endBlock.getEntityAt(endOffset - 1);

    // Check whether the selection state overlaps with a single entity.
    // If so, try to remove the appropriate substring of the entity text.
    if (startKey === endKey) {
      if (startEntityKey && startEntityKey === endEntityKey) {
        const adjustedRemovalRange = getCharacterRemovalRange(
          contentState.getEntityMap(),
          startBlock,
          endBlock,
          rangeToRemove,
          removalDirection,
        );
        return removeRangeFromContentState(contentState, adjustedRemovalRange);
      }
    }
    let adjustedRemovalRange = rangeToRemove;
    if (DraftFeatureFlags.draft_segmented_entities_behavior) {
      // Adjust the selection to properly delete segemented and immutable
      // entities
      adjustedRemovalRange = getCharacterRemovalRange(
        contentState.getEntityMap(),
        startBlock,
        endBlock,
        rangeToRemove,
        removalDirection,
      );
    }

    var withoutEntities = removeEntitiesAtEdges(
      contentState,
      adjustedRemovalRange,
    );
    return removeRangeFromContentState(withoutEntities, adjustedRemovalRange);
  },

  splitBlock: function(
    contentState: ContentState,
    selectionState: SelectionState,
  ): ContentState {
    var withoutEntities = removeEntitiesAtEdges(contentState, selectionState);
    var withoutText = removeRangeFromContentState(
      withoutEntities,
      selectionState,
    );

    return splitBlockInContentState(
      withoutText,
      withoutText.getSelectionAfter(),
    );
  },

  applyInlineStyle: function(
    contentState: ContentState,
    selectionState: SelectionState,
    inlineStyle: string,
  ): ContentState {
    return ContentStateInlineStyle.add(
      contentState,
      selectionState,
      inlineStyle,
    );
  },

  removeInlineStyle: function(
    contentState: ContentState,
    selectionState: SelectionState,
    inlineStyle: string,
  ): ContentState {
    return ContentStateInlineStyle.remove(
      contentState,
      selectionState,
      inlineStyle,
    );
  },

  setBlockType: function(
    contentState: ContentState,
    selectionState: SelectionState,
    blockType: DraftBlockType,
  ): ContentState {
    return modifyBlockForContentState(
      contentState,
      selectionState,
      (block) => block.merge({type: blockType, depth: 0}),
    );
  },

  setBlockData: function(
    contentState: ContentState,
    selectionState: SelectionState,
    blockData: Map<any, any>,
  ): ContentState {
    return modifyBlockForContentState(
      contentState,
      selectionState,
      (block) => block.merge({data: blockData}),
    );
  },

  mergeBlockData: function(
    contentState: ContentState,
    selectionState: SelectionState,
    blockData: Map<any, any>,
  ): ContentState {
    return modifyBlockForContentState(
      contentState,
      selectionState,
      (block) => block.merge({data: block.getData().merge(blockData)}),
    );
  },


  applyEntity: function(
    contentState: ContentState,
    selectionState: SelectionState,
    entityKey: ?string,
  ): ContentState {
    var withoutEntities = removeEntitiesAtEdges(contentState, selectionState);
    return applyEntityToContentState(
      withoutEntities,
      selectionState,
      entityKey,
    );
  },
};

module.exports = DraftModifier;
