/**
 * Skeleton loading DOM helper.
 * Split out of the old constants.js — pure DOM concern, used by index + state views.
 */
(function (global) {
    'use strict';

    /**
     * Create a skeleton loading item for visual loading feedback
     * @returns {HTMLLIElement} A skeleton list item element
     */
    function createSkeletonItem() {
        var item = document.createElement('li');
        item.className = 'skeleton-item';
        item.setAttribute('aria-hidden', 'true');

        var name = document.createElement('div');
        name.className = 'skeleton skeleton-name';
        item.appendChild(name);

        var address = document.createElement('div');
        address.className = 'skeleton skeleton-address';
        item.appendChild(address);

        var price = document.createElement('div');
        price.className = 'skeleton skeleton-price';
        item.appendChild(price);

        return item;
    }

    var api = { createSkeletonItem: createSkeletonItem };

    if (typeof window !== 'undefined') {
        window.CoffeeShopSkeleton = api;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
