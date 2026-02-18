export interface RedditPost {
  id: string;
  title: string;
  subreddit: string;
  score: number;
  numComments: number;
  createdUtc: number;
  selftext: string;
  permalink: string;
  mentionsSoma: boolean;
}

export interface RedditComment {
  id: string;
  subreddit: string;
  score: number;
  body: string;
  createdUtc: number;
  linkTitle: string;
  permalink: string;
  mentionsSoma: boolean;
}

export interface RedditData {
  posts: RedditPost[];
  comments: RedditComment[];
  fetchedAt: number;
}
