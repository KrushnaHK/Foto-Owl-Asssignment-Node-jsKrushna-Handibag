const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "dataBase.db");
let db = null;

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    app.listen(3000, () => {
      console.log("Server is running at http://localhost:3000");
    });
  } catch (e) {
    console.log(`DB Error : ${e.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

//API 1 Register User
app.post("/register/", async (request, response) => {
  const { email, password, role } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const checkUser = `
        SELECT *
        FROM user 
        WHERE email = '${email}';
    `;
  const dbUser = await db.get(checkUser);
  if (dbUser !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const requestQuery = `
                INSERT INTO 
                    user (email, password, role)
                VALUES (
                    '${email}',
                    '${hashedPassword}',
                    '${role}'
                );
            `;
      await db.run(requestQuery);
      response.status(200);
      response.send("User created successfully");
    }
  }
});

//API 2 Login User: Create a new library user (email and password).
app.post("/login/", async (request, response) => {
  const { email, password } = request.body;
  const checkUser = `
        SELECT *
        FROM user 
        WHERE email = '${email}';
    `;
  const dbUser = await db.get(checkUser);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = {
        email: email,
      };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//Authentication with JWT Token
const authenticateToken = (request, response, next) => {
  let jwtToken;

  const authHeader = request.headers["authorization"];

  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  } else {
    response.status(401);
    response.send("Invalid JWT Token");
  }

  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

//****************Librarian APIs*****************

//GET /api/borrow-requests: View all book borrow requests.
app.get(
  "/api/borrow-requests",
  authenticateToken,
  async (request, response) => {
    const getBorrowRequestsQuery = `
      SELECT 
        br.id AS request_id,
        u.email AS user_email,
        b.title AS book_title,
        br.start_date,
        br.end_date,
        br.status
      FROM 
        borrow_requests AS br
      JOIN 
        user u ON br.user_id = u.id
      JOIN 
        books b ON br.book_id = b.id;
    `;
    const borrowRequests = await db.all(getBorrowRequestsQuery);

    response.status(200);
    response.send(borrowRequests);
  }
);

//PUT /api/borrow-requests/:id/approve: Approve a borrow request.
app.put(
  "/api/borrow-requests/:id/approve",
  authenticateToken,
  async (request, response) => {
    const { id } = request.params;
    // Check if the borrow request exists and is pending
    const getBorrowRequestQuery = `
        SELECT 
          br.*, 
          b.quantity 
        FROM 
          borrow_requests AS br
        JOIN 
          books b ON br.book_id = b.id
        WHERE 
          br.id = ${id} AND br.status = 'Pending';
      `;
    const borrowRequest = await db.get(getBorrowRequestQuery);

    if (borrowRequest === undefined) {
      response.status(400);
      response.send("Borrow request not found or already processed");
      return;
    }

    // Check if the book is available
    if (borrowRequest.quantity <= 0) {
      response.status(400);
      response.send("Book not available for approval");
      return;
    }

    // Approve the borrow request and reduce book quantity
    const approveRequestQuery = `
        UPDATE 
          borrow_requests
        SET 
          status = 'Approved'
        WHERE 
          id = ${id};
      `;
    await db.run(approveRequestQuery);

    const updateBookQuantityQuery = `
        UPDATE 
          books
        SET 
          quantity = quantity - 1
        WHERE 
          id = ${borrowRequest.book_id};
      `;
    await db.run(updateBookQuantityQuery);

    response.status(200);
    response.send("Borrow request approved successfully");
  }
);

//PUT /api/borrow-requests/:id/deny: Deny a borrow request.
app.put(
  "/api/borrow-requests/:id/deny",
  authenticateToken,
  async (request, response) => {
    const { id } = request.params;
    const getBorrowRequestQuery = `
        SELECT 
          * 
        FROM 
          borrow_requests 
        WHERE 
          id = ${id} AND status = 'Pending';
      `;
    const borrowRequest = await db.get(getBorrowRequestQuery);

    if (borrowRequest === undefined) {
      response.status(400);
      response.send("Borrow request not found or already processed");
      return;
    }

    // Deny the borrow request
    const denyRequestQuery = `
        UPDATE 
          borrow_requests
        SET 
          status = 'Denied'
        WHERE 
          id = ${id};
      `;
    await db.run(denyRequestQuery);

    response.status(200);
    response.send("Borrow request denied successfully");
  }
);

//GET /api/users/:id/history: View a user's borrow history.
app.get(
  "/api/users/:id/history",
  authenticateToken,
  async (request, response) => {
    const { id } = request.params;
    // Query to fetch borrow history for the user
    const getUserHistoryQuery = `
      SELECT 
        bh.id AS borrow_history_id,
        b.title,
        b.author,
        bh.borrowed_on,
        bh.returned_on
      FROM 
        borrow_history AS bh
      INNER JOIN 
        books AS b
      ON 
        bh.book_id = b.id
      WHERE 
        bh.user_id = ${id};
    `;

    const userHistory = await db.all(getUserHistoryQuery);

    if (userHistory.length === 0) {
      response.status(404);
      response.send("No borrow history found for the user");
    } else {
      response.status(200);
      response.send(userHistory);
    }
  }
);

//****************Library User APIs**************

//GET /api/books: Get list of all available books.
app.get("/api/books", authenticateToken, async (request, response) => {
  const getAvailableBooksQuery = `
      SELECT
        *
      FROM
        books
      WHERE
        quantity > 0;`;
  const availableBooksArray = await db.all(getAvailableBooksQuery);
  response.send(availableBooksArray);
});

//POST /api/borrow-requests: Submit a request to borrow a book (with start_date and end_date).
app.post(
  "/api/borrow-requests",
  authenticateToken,
  async (request, response) => {
    const { user_id, book_id, start_date, end_date } = request.body;
    const checkBookQuery = `
      SELECT 
        quantity 
      FROM 
        books 
      WHERE 
        id = ${book_id};
    `;
    const book = await db.get(checkBookQuery);

    if (book === undefined) {
      response.status(400);
      response.send("Book not found");
    } else if (book.quantity <= 0) {
      response.status(400);
      response.send("Book not available");
    } else {
      const createBorrowRequestQuery = `
        INSERT INTO borrow_requests (user_id, book_id, start_date, end_date, status)
        VALUES (${user_id}, ${book_id}, '${start_date}', '${end_date}', 'Pending');
      `;
      await db.run(createBorrowRequestQuery);

      response.status(200);
      response.send("Borrow request submitted successfully");
    }
  }
);

//GET /api/users/:id/history: View the user's borrow history
app.get(
  "/api/users/:id/history",
  authenticateToken,
  async (request, response) => {
    const { id } = request.params;

    // Query to fetch borrow history with book details
    const getUserHistoryQuery = `
      SELECT
        bh.borrowed_on,
        bh.returned_on,
        b.title,
        b.author
      FROM
        borrow_history AS bh
      INNER JOIN
        books AS b
      ON
        bh.book_id = b.id
      WHERE
        bh.user_id = ${id};
    `;

    const userHistory = await db.all(getUserHistoryQuery);

    // Check if history exists
    if (userHistory.length === 0) {
      response.status(404);
      response.send("No borrow history found for the user");
    } else {
      response.status(200);
      response.send(userHistory);
    }
  }
);

module.exports = app;
