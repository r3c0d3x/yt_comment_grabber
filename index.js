'use strict';

const OPTIONS = require('./opts.json');

const async = require('async');
const fs = require('fs-extra');
let youtube = require('googleapis').youtube({
    version: 'v3',
    auth: OPTIONS.key
});

function writePage(id, page, data) {
    console.log('Writing file %s for id: %s', page, id);
    fs.outputFileSync(OPTIONS.out + '/' + id + '/' + Math.ceil(1 / 5000) + '/' + page + '.json', JSON.stringify(data));
}

function get(func, opts, cb) {
    async.retry({
        times: 10,
        interval: 1000
    }, (retryCb) => {
        setTimeout(() => {
            func(opts, (err, data) => {
                let newErr = err;

                if (err === undefined) {
                    newErr = null;
                }

                retryCb(newErr, data)
            });
        }, 50);
    }, (err, data) => cb(err, data));
}

function run(func, cb) {
    async.doWhilst(func, (val) => val, cb);
}

function prepOpts(opts, pageToken) {
    if (typeof pageToken === 'string' && pageToken !== '') {
        let newOpts = opts;

        newOpts.pageToken = pageToken;
        return newOpts;
    } else {
        return opts;
    }
}

function getPlaylistVideos(playlistId, cb) {
    console.log('Getting videos for playlist: %s', playlistId);

    let ids = [];
    let page = 0;
    let pageToken = '';

    run((runCb) => {
        page += 1;

        console.log('Getting page %s of videos for playlist: %s', page, playlistId);

        get(youtube.playlistItems.list, prepOpts({
            part: 'contentDetails',
            playlistId: playlistId,
            maxResults: 50
        }, pageToken), (apiErr, apiData) => {
            if (apiErr === null) {
                ids = ids.concat(apiData.items.map((item) => {
                    return item.contentDetails.videoId;
                }));

                if (typeof apiData.nextPageToken !== 'undefined') {
                    pageToken = apiData.nextPageToken;
                } else {
                    pageToken = '';
                }

                runCb(null, pageToken !== '');
            } else {
                runCb(apiErr, null);
            }
        });
    }, (runErr) => {
        if (runErr === null) {
            cb(null, ids);
        } else {
            cb(runErr, null);
        }
    });
}

function getCommentReplies(commentId, cb) {
    console.log('Getting replies for comment: %s', commentId);

    let comments = [];
    let page = 0;
    let pageToken = '';

    run((runCb) => {
        page += 1;

        console.log('Getting page %s of replies for comment: %s', page, commentId);

        get(youtube.comments.list, prepOpts({
            part: 'snippet',
            maxResults: 100,
            parentId: commentId
        }, pageToken), (apiErr, apiData) => {
            if (apiErr === null) {
                comments = comments.concat(apiData.items);

                if (typeof apiData.nextPageToken !== 'undefined') {
                    pageToken = apiData.nextPageToken;
                } else {
                    pageToken = '';
                }

                runCb(null, pageToken !== '');
            } else {
                runCb(apiErr, null);
            }
        });
    }, (runErr) => {
        if (runErr === null) {
            cb(null, comments);
        } else {
            cb(runErr, null);
        }
    });
}

function getVideoComments(videoId, cb) {
    console.log('Getting comments for video: %s', videoId);

    let comments = [];
    let page = 0;
    let pageToken = '';

    run((runCb) => {
        page += 1;

        console.log('Getting page %s of comments for video: %s', page, videoId);

        get(youtube.commentThreads.list, prepOpts({
            part: 'id,replies,snippet',
            videoId: videoId,
            maxResults: 100,
            textFormat: 'html'
        }, pageToken), (apiErr, apiData) => {
            if (apiErr === null) {
                async.mapSeries(apiData.items, (item, mapCb) => {
                    if (item.snippet.totalReplyCount > 0) {
                        if (typeof item.replies !== 'undefined' && item.totalReplyCount === item.replies.length) {
                            mapCb(null, item);
                        } else {
                            getCommentReplies(item.id, (repliesErr, repliesData) => {
                                if (repliesErr === null) {
                                    let newItem = item;
                                    newItem.replies = repliesData;
                                    mapCb(null, newItem);
                                } else {
                                    mapCb(repliesErr, null);
                                }
                            });
                        }
                    } else {
                        mapCb(null, item);
                    }
                }, (mapErr, mapData) => {
                    if (typeof apiData.nextPageToken !== 'undefined') {
                        pageToken = apiData.nextPageToken;
                    } else {
                        pageToken = '';
                    }

                    comments = comments.concat(mapData);

                    runCb(null, pageToken !== '');
                });
            } else {
                if (apiErr.errors[0].reason === 'commentsDisabled') {
                    runCb(null, false);
                } else if (apiErr.errors[0].reason === 'processingFailure') {
                    runCb('retry', null);
                } else {
                    runCb(apiErr, null);
                }
            }
        });
    }, (runErr) => {
        if (runErr === null) {
            cb(null, comments);
        } else if (runErr === 'retry') {
            setTimeout(() => {
                getVideoComments(videoId, cb);
            }, 10000);
        } else {
            cb(runErr, null);
        }
    });
}

async.eachSeries(require('./pewdiepie_.json'), (item, eachCb) => {
    getVideoComments(item, (commentsErr, commentsData) => {
        if (commentsErr === null) {
            let comments = commentsData;
            let chunks = [];
            let size = 100;

            while (comments.length > size) {
                chunks.push(comments.splice(0, size));
            }

            chunks.forEach((chunk, index) => {
                writePage(item, index, chunk); 
            });

            eachCb(null);
        } else {
            console.log(commentsErr)
        }
    });
}, (eachErr) => {
    if (eachErr !== null) {
        console.log(eachErr);
    }
});
